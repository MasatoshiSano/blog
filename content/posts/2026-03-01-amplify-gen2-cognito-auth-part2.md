---
title: "Amplify Gen 2の認証状態を管理する（第2回）— Zustand + React Routerで保護ルートを実装"
emoji: "🛡️"
type: "tech"
topics: ["Amplify", "Cognito", "React", "Zustand", "Auth"]
published: true
category: "HowTo"
date: "2026-03-01"
description: "Zustandで認証状態を一元管理し、React Routerの保護ルート・ロールベース制御・セッションタイムアウトまでを実装する"
series: "Amplify Gen 2でCognito認証を実装する"
seriesOrder: 2
coverImage: "/images/posts/amplify-gen2-cognito-auth-part2-cover.jpg"
---

> **このシリーズ: 全3回**
> 1. [第1回: defineAuthからログインUIまで](/posts/amplify-gen2-cognito-auth-part1)
> 2. [第2回: 認証状態管理と保護ルート](/posts/amplify-gen2-cognito-auth-part2) ← 今ここ
> 3. [第3回: バックエンドJWT検証と監査ログ](/posts/amplify-gen2-cognito-auth-part3)

## 概要

[第1回](/posts/amplify-gen2-cognito-auth-part1)ではCognitoの認証バックエンドとログインUIを実装した。しかし、認証はログインフォームだけでは完結しない。

- ページ遷移のたびに「このユーザーはログイン済みか？」を判定する仕組み
- 未認証ユーザーをログインページにリダイレクトする保護ルート
- 管理者のみアクセス可能なルート
- 一定時間操作がなければ自動ログアウトするセッション管理

この記事では、**Zustandで認証状態を一元管理**し、**React Routerで保護ルート・ロールベース制御を実装**する方法を解説する。

## こんな人向け

- Amplify Gen 2 + Cognitoで認証状態をグローバルに管理したい人
- React Routerで認証ガードを実装したい人
- ロールベースアクセス制御（RBAC）をフロントエンドに導入したい人
- セッションタイムアウトの実装パターンを知りたい人

## 前提条件

- [第1回](/posts/amplify-gen2-cognito-auth-part1)の実装が完了していること
- `zustand` がインストール済み
- `react-router` v7+ がインストール済み

```bash
npm install zustand react-router
```

## 手順

### 1. Zustand認証ストアを設計する

まず、アプリ全体で共有する認証状態を定義する。

```typescript
// src/features/auth/stores/authStore.ts
import { create } from 'zustand'

interface User {
  id: string
  email: string
  displayName: string
  role: UserRole
  language: string
  displayTheme: string
  createdAt: string
  updatedAt: string
}

type UserRole = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER' | 'ADMIN' | 'MEMBER'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // 初期値はtrue — 認証チェック完了まで
  setUser: (user) =>
    set({
      user,
      isAuthenticated: user !== null,
      isLoading: false,
    }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () =>
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    }),
}))
```

#### 設計判断: なぜ `isLoading` の初期値が `true` なのか

アプリ起動時、Cognitoのセッション確認（`getCurrentUser()`）が完了するまでの間、認証状態は「不明」だ。この間 `isLoading: false, isAuthenticated: false` だと、一瞬ログインページが表示されてからチャット画面に飛ぶという「フラッシュ」が起きる。

`isLoading: true` を初期値にすることで、認証チェック中はローディングスピナーを表示し、判定が確定してから画面を表示できる。

```
アプリ起動
  ↓
isLoading: true → スピナー表示
  ↓
getCurrentUser() 完了
  ├─ セッションあり → isAuthenticated: true → メイン画面
  └─ セッションなし → isAuthenticated: false → ログイン画面
```

### 2. AuthInitializer — アプリ起動時の認証チェック

`Root.tsx` で認証の初期化を行うラッパーコンポーネントを作る。

```tsx
// src/app/Root.tsx
import { useEffect, useCallback } from 'react'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '../features/auth/hooks/useAuth'
import { useSessionTimeout } from '../features/auth/hooks/useSessionTimeout'
import { App } from './App'

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { checkCurrentUser, signOut } = useAuth()

  // セッションタイムアウト時のコールバック
  const handleSessionTimeout = useCallback(async () => {
    await signOut()
    window.location.href = '/login'
  }, [signOut])

  useSessionTimeout(handleSessionTimeout)

  // アプリ起動時に現在のユーザーを確認
  useEffect(() => {
    checkCurrentUser()
  }, [checkCurrentUser])

  return <>{children}</>
}

export function Root() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthInitializer>
            <App />
          </AuthInitializer>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
```

#### ポイント: `AuthInitializer` を分離する理由

認証ロジックを `Root` に直接書かず、`AuthInitializer` として分離するのは:

1. **フックの使用制約**: `useAuth` は `BrowserRouter` 配下（`useNavigate` が使えるスコープ）に置く必要がある
2. **テスタビリティ**: 認証部分だけをモックしやすい
3. **関心の分離**: `Root` はProviderの積み重ね、`AuthInitializer` は認証の初期化、と役割が明確

### 3. ProtectedRoute — 認証ガード

未認証ユーザーをログインページにリダイレクトする保護ルートを実装する。

```tsx
// src/features/auth/components/ProtectedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuthStore } from '../stores/authStore'
import { LoadingSpinner } from '../../shared/components/LoadingSpinner'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()

  // 認証チェック中はスピナー表示
  if (isLoading) {
    return <LoadingSpinner />
  }

  // 未認証ならログインページへ（現在のパスを保存）
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // 認証済みなら子ルートをレンダリング
  return <Outlet />
}
```

`state={{ from: location }}` でリダイレクト元のパスを保存しておくのがポイント。ログイン成功後にユーザーを元のページに戻せる。ログインフォーム側では:

```typescript
const location = useLocation()
const from = (location.state as { from?: Location })?.from?.pathname ?? '/'

// ログイン成功後
navigate(from, { replace: true })
```

### 4. AdminRoute — ロールベースのアクセス制御

管理者のみがアクセスできるルートも同じパターンで作れる。

```tsx
// src/features/auth/components/AdminRoute.tsx
import { Navigate, Outlet } from 'react-router'
import { useAuthStore } from '../stores/authStore'
import { LoadingSpinner } from '../../shared/components/LoadingSpinner'

function isAdminRole(role: UserRole): boolean {
  return ['SUPER_ADMIN', 'ORG_ADMIN', 'ADMIN'].includes(role)
}

export function AdminRoute() {
  const { user, isLoading } = useAuthStore()

  if (isLoading) {
    return <LoadingSpinner />
  }

  // 未認証 or 管理者でなければホームへ
  if (!user || !isAdminRole(user.role)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
```

### 5. ルーティング定義 — レイアウトルートの入れ子

React Router v7 のレイアウトルート機能を使い、保護ルートを入れ子構造で定義する。

```tsx
// src/app/routes.tsx
import { Routes, Route } from 'react-router'
import { ProtectedRoute } from '../features/auth/components/ProtectedRoute'
import { AdminRoute } from '../features/auth/components/AdminRoute'
import { AppLayout } from './AppLayout'
import { LoginForm } from '../features/auth/components/LoginForm'
import { RegisterForm } from '../features/auth/components/RegisterForm'
import { PasswordResetForm } from '../features/auth/components/PasswordResetForm'

export function AppRoutes() {
  return (
    <Routes>
      {/* パブリックルート — 誰でもアクセス可能 */}
      <Route path="/login" element={<LoginForm />} />
      <Route path="/register" element={<RegisterForm />} />
      <Route path="/password-reset" element={<PasswordResetForm />} />

      {/* 保護されたルート — 認証必須 */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ChatContainer />} />
          <Route path="/profile" element={<ProfileSettings />} />

          {/* 管理者ルート — ADMIN以上のみ */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<UserList />} />
            <Route path="/admin/audit-log" element={<AuditLogView />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
```

この入れ子構造のポイント:

```
Routes
├── /login, /register, /password-reset  ← パブリック（誰でもOK）
└── ProtectedRoute                       ← 認証チェック
    └── AppLayout                        ← サイドバー等の共通レイアウト
        ├── /, /profile                  ← 一般ユーザー
        └── AdminRoute                   ← 管理者チェック
            └── /admin, /admin/users     ← 管理者のみ
```

React Router のレイアウトルート（`<Route element={<ProtectedRoute />}>`）は `path` を持たない。子ルートにマッチしたときに `element` が評価され、`<Outlet />` で子をレンダリングする。これにより認証チェックが自然に階層化される。

### 6. セッションタイムアウト

一定時間ユーザー操作がなければ自動ログアウトする仕組みを実装する。

```typescript
// src/features/auth/hooks/useSessionTimeout.ts
import { useEffect, useRef, useCallback } from 'react'

const SESSION_TIMEOUT = 30 * 60 * 1000 // 30分
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const

export function useSessionTimeout(onTimeout: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(onTimeout, SESSION_TIMEOUT)
  }, [onTimeout])

  useEffect(() => {
    // 初回タイマー設定
    resetTimer()

    // ユーザー操作でリセット
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer, { passive: true })
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer)
      }
    }
  }, [resetTimer])
}
```

#### 設計のポイント

- **イベント選定**: `mousedown`, `keydown`, `touchstart`, `scroll` の4つ。`mousemove` は含めない（マウスが動いただけでは「操作」とは言えない）
- **`passive: true`**: スクロールパフォーマンスへの影響を防ぐ
- **タイムアウト時間**: 30分は金融系アプリの一般的な基準。用途に応じて調整する

## ポイント・注意点

### Cognitoセッションの永続性

Amplify v6 はデフォルトでCognitoトークン（IDトークン・アクセストークン・リフレッシュトークン）をブラウザの `localStorage` に保存する。つまり、ブラウザを閉じて再度開いても、リフレッシュトークンが有効な限りログイン状態が維持される。

`checkCurrentUser()` はこの保存済みトークンを使って `getCurrentUser()` を呼ぶ。トークンが有効なら即座にユーザー情報が取得でき、期限切れならリフレッシュトークンで自動更新される。

### なぜ Context でなく Zustand なのか

React Context + useReducer でも認証状態管理はできるが、Zustand を選んだ理由:

1. **再レンダリングの最適化**: Zustandはセレクタベースのサブスクリプションで、`isAuthenticated` だけを購読するコンポーネントは `user` が変わっても再レンダリングされない
2. **React外からのアクセス**: `useAuthStore.getState()` でReactコンポーネント外（APIクライアントのインターセプタ等）からも状態を読める
3. **ボイラープレートの少なさ**: Provider不要、`create` 1回で完了

### 認証済みユーザーがログインページにアクセスした場合

この実装では認証済みユーザーが `/login` にアクセスしても特別なリダイレクトはしていない。実運用では `LoginForm` 内で `isAuthenticated` を確認し、`/` にリダイレクトする処理を入れるとよい。

## まとめ

- **Zustand認証ストア**: `isLoading: true` を初期値にして認証フラッシュを防ぐ
- **AuthInitializer**: アプリ起動時に `checkCurrentUser()` で既存セッションを復元
- **ProtectedRoute**: レイアウトルートとして入れ子にし、認証チェックを階層化
- **AdminRoute**: ロールベースの追加チェック。同じパターンで権限レベルを拡張可能
- **セッションタイムアウト**: ユーザー操作イベントでリセットする30分タイマー

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> React + TypeScript + Zustand + React Router v7プロジェクトにCognito認証の状態管理と保護ルートを追加してください。
>
> 要件:
> - Zustand認証ストア: `user`, `isAuthenticated`, `isLoading`（初期値true）, `setUser`, `clear` を持つ
> - `AuthInitializer` コンポーネント: `BrowserRouter` 配下に置き、`useEffect` でアプリ起動時に `checkCurrentUser()` を実行
> - `ProtectedRoute`: 未認証時は `/login` にリダイレクト（`state={{ from: location }}` でリダイレクト元を保存）。`isLoading` 中はスピナー表示
> - `AdminRoute`: ロールが SUPER_ADMIN / ORG_ADMIN / ADMIN 以外なら `/` にリダイレクト
> - ルーティング: パブリック（/login, /register, /password-reset）→ ProtectedRoute → AppLayout → AdminRoute の入れ子構造
> - セッションタイムアウト: 30分間操作なしで自動ログアウト。mousedown/keydown/touchstart/scrollイベントでリセット
>
> 注意点:
> - `isLoading` の初期値を `true` にしないと認証フラッシュが発生する
> - `ProtectedRoute` と `AdminRoute` は React Router のレイアウトルート（`path` なし）として使う
> - セッションタイムアウトの `onTimeout` では `signOut()` 後に `window.location.href = '/login'` でハードリダイレクト

### エージェントに指示するときの注意点

- **ストア設計を先に指示する**: UIコンポーネントの前に Zustand ストアを作らせる。ストアのインターフェースが固まっていないと、各コンポーネントの実装で手戻りが発生する
- **レイアウトルートの入れ子を図で示す**: 「ProtectedRoute の中に AdminRoute を入れ子にする」と文章で書くだけでは、フラットに並べられることがある。ASCII図で構造を明示する
- **`isLoading` の初期値を `true` にする理由を説明する**: 理由を書かないとエージェントが `false` に「修正」してしまうことがある

---

次回: [第3回: バックエンドJWT検証と監査ログ](/posts/amplify-gen2-cognito-auth-part3) では、Lambda Function URLでCognito JWTを検証し、監査ログを統合する方法を解説します。
