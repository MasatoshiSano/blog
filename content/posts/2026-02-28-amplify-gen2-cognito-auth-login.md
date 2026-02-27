---
title: "Amplify Gen 2 + Cognitoでログイン認証を実装する — defineAuthからJWT検証まで"
emoji: "🔐"
type: "tech"
topics: ["Cognito", "Amplify", "React", "TypeScript", "AWS"]
published: true
category: "HowTo"
date: "2026-02-28"
description: "Amplify Gen 2のdefineAuthでCognito認証を構築し、React側のuseAuthフック・ProtectedRoute・Lambda JWT検証まで一気通貫で実装する方法。"
---

## 概要

Webアプリにログイン認証を追加する場合、AWSならCognitoが第一候補になる。しかし、Amplify Gen 2ではバックエンド定義が大きく変わり、従来のAmplify CLIとはアプローチが異なる。

本記事では、**Amplify Gen 2 の `defineAuth` でCognitoを設定し、React側のログイン/登録/パスワードリセット、ProtectedRoute、Lambda Function URLでのJWT検証**まで、認証の全レイヤーを実装する方法を解説する。

### 読者が得られるもの

- Amplify Gen 2の`defineAuth`によるCognitoセットアップ（1行で完結）
- `aws-amplify/auth`を使った`useAuth`フックの設計パターン
- 2ステップ登録フロー（サインアップ → メール確認 → 自動ログイン）
- React RouterのOutletパターンによるProtectedRoute
- **Lambda Function URLでの自前JWT検証**（外部ライブラリ不要、Web Crypto API使用）

## 前提条件

- AWS Amplify Gen 2（`@aws-amplify/backend`）
- React + React Router v7
- TypeScript
- Zustand（状態管理）

## アーキテクチャ

```text
ユーザー → React App
             │
             ├── LoginForm / RegisterForm / PasswordResetForm
             │     └── useAuth hook → aws-amplify/auth → Cognito
             │
             ├── ProtectedRoute（認証ガード）
             │     └── useAuthStore（Zustand）
             │
             └── API リクエスト（Bearer トークン付き）
                   └── Lambda Function URL
                         └── verifyJwt（Web Crypto API）
                               └── Cognito JWKS エンドポイント
```

## 手順

### 1. defineAuth でCognitoを定義する

Amplify Gen 2では、`defineAuth`一行でCognito User Poolが作成される。

```typescript
// amplify/auth/resource.ts
import { defineAuth } from '@aws-amplify/backend'

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
})
```

これだけで以下が自動生成される:
- Cognito User Pool（メール認証付き）
- User Pool Client
- 確認メール送信設定
- `amplify_outputs.json`への接続情報出力

### 2. Amplify設定を安全に読み込む

`amplify_outputs.json`はsandboxやデプロイ時に自動生成されるファイル。ローカル開発でファイルが存在しない場合にビルドエラーにならないよう、`import.meta.glob`で動的に読み込む。

```typescript
// src/lib/amplify.ts
import { Amplify } from 'aws-amplify'

export async function configureAmplify(): Promise<boolean> {
  const modules = import.meta.glob<Record<string, unknown>>(
    '/amplify_outputs.json',
    { eager: false },
  )
  const loader = modules['/amplify_outputs.json']

  if (!loader) {
    console.warn(
      'amplify_outputs.json not found.',
      'Run `npx ampx sandbox` to generate the backend configuration.',
    )
    return false
  }

  try {
    const outputs = await loader()
    Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0])
    return true
  } catch (err) {
    console.warn('Failed to configure Amplify:', err)
    return false
  }
}
```

**ポイント**: 静的`import`や`import()`だとファイルが無い場合にビルドが失敗する。`import.meta.glob`はファイルが存在しない場合に空オブジェクトを返すだけなので安全。

### 3. 認証状態をZustandで管理する

Cognito認証の状態はグローバルに参照するため、Zustandストアで管理する。

```typescript
// src/features/auth/stores/authStore.ts
import { create } from 'zustand'
import type { User } from '@/types'

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
  isLoading: true,  // 初期状態はローディング中
  setUser: (user) =>
    set({ user, isAuthenticated: user !== null, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () =>
    set({ user: null, isAuthenticated: false, isLoading: false }),
}))
```

`isLoading: true`を初期値にしておくのが重要。アプリ起動時にCognitoセッションの確認が完了するまで、ProtectedRouteが未認証と判定してログイン画面にリダイレクトするのを防ぐ。

### 4. useAuth フックを実装する

`aws-amplify/auth`の各関数を`useCallback`でラップし、Zustandストアと連携する。

```typescript
// src/features/auth/hooks/useAuth.ts
import { useCallback } from 'react'
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  signOut as amplifySignOut,
  confirmSignUp as amplifyConfirmSignUp,
  resetPassword as amplifyResetPassword,
  confirmResetPassword as amplifyConfirmResetPassword,
  getCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth'
import { useAuthStore } from '../stores/authStore'

export function useAuth() {
  const { user, isAuthenticated, isLoading, setUser, setLoading, clear } =
    useAuthStore()

  const checkCurrentUser = useCallback(async () => {
    try {
      setLoading(true)
      const { userId } = await getCurrentUser()
      const attributes = await fetchUserAttributes()

      const currentUser = {
        id: userId,
        email: attributes.email ?? '',
        displayName: attributes.name ?? attributes.email ?? '',
        role: 'MEMBER' as const,
        // ... その他のフィールド
      }
      setUser(currentUser)
    } catch {
      clear() // セッションが無い場合はクリア
    }
  }, [setUser, setLoading, clear])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await amplifySignIn({ username: email, password })
      if (result.nextStep.signInStep === 'DONE') {
        await checkCurrentUser()
      }
      return result
    },
    [checkCurrentUser],
  )

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      return amplifySignUp({
        username: email,
        password,
        options: {
          userAttributes: { email, name: displayName },
        },
      })
    },
    [],
  )

  const confirmSignUp = useCallback(
    async (email: string, code: string) => {
      await amplifyConfirmSignUp({ username: email, confirmationCode: code })
    },
    [],
  )

  const signOut = useCallback(async () => {
    await amplifySignOut()
    clear()
  }, [clear])

  return {
    user, isAuthenticated, isLoading,
    checkCurrentUser, signIn, signUp, confirmSignUp, signOut,
    // resetPassword, confirmResetPassword も同様にラップ
  }
}
```

**設計判断**: `signIn`成功後に`checkCurrentUser`を呼ぶのは、Cognitoのユーザー属性（`name`、`email`等）をアプリ側のUser型に変換するため。`signIn`のレスポンスだけでは属性が取得できない。

### 5. ログインフォームを作る

Cognitoのエラーはerror name（例: `NotAuthorizedException`）で判別する。ユーザーフレンドリーなメッセージにマッピングしておく。

```typescript
// src/features/auth/components/LoginForm.tsx
const handleSubmit = async (e: FormEvent) => {
  e.preventDefault()
  setIsSubmitting(true)
  try {
    const result = await signIn(email, password)
    if (result.nextStep.signInStep === 'DONE') {
      navigate(from, { replace: true })  // 元のページにリダイレクト
    } else if (result.nextStep.signInStep === 'RESET_PASSWORD') {
      navigate('/password-reset')
    }
  } catch (err) {
    if (err instanceof Error) {
      setError(getErrorMessage(err.name))
    }
  } finally {
    setIsSubmitting(false)
  }
}

function getErrorMessage(errorName: string): string {
  switch (errorName) {
    case 'NotAuthorizedException':
      return 'メールアドレスまたはパスワードが正しくありません。'
    case 'UserNotFoundException':
      return 'アカウントが見つかりません。'
    case 'UserNotConfirmedException':
      return 'アカウントが確認されていません。メールを確認してください。'
    case 'TooManyRequestsException':
      return 'リクエスト数が上限に達しました。しばらく待ってから再試行してください。'
    default:
      return 'ログインに失敗しました。再度お試しください。'
  }
}
```

**ポイント**: `location.state.from`を使ってリダイレクト先を保存しておく。ログイン後に、ユーザーが元々アクセスしようとしていたページに戻れる。

### 6. 2ステップ登録フローを実装する

Cognito のメール認証付き登録は、「サインアップ → 確認コード入力」の2ステップになる。

```typescript
// src/features/auth/components/RegisterForm.tsx
type Step = 'register' | 'confirm'
const [step, setStep] = useState<Step>('register')

// ステップ1: サインアップ
const handleRegister = async (e: FormEvent) => {
  const result = await signUp(email, password, displayName)
  if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
    setStep('confirm')  // 確認コード画面に遷移
  }
}

// ステップ2: コード確認 → 自動ログイン
const handleConfirm = async (e: FormEvent) => {
  await confirmSignUp(email, confirmationCode)
  await signIn(email, password)  // 確認後に自動でログイン
  navigate('/', { replace: true })
}
```

**設計判断**: 確認後に自動ログインするため、パスワードをstateに保持しておく。確認→手動ログインの2アクションをユーザーに求めるのはUXが悪い。

### 7. ProtectedRoute でルートを保護する

React Router v7のOutletパターンを使い、認証が必要なルートをラップする。

```typescript
// src/features/auth/components/ProtectedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuthStore } from '../stores/authStore'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
```

ルーティング定義ではネストして使う:

```typescript
// src/app/routes.tsx
<Routes>
  {/* 公開ルート */}
  <Route path="/login" element={<LoginForm />} />
  <Route path="/register" element={<RegisterForm />} />
  <Route path="/password-reset" element={<PasswordResetForm />} />

  {/* 認証が必要なルート */}
  <Route element={<ProtectedRoute />}>
    <Route element={<AppLayout />}>
      <Route path="/" element={<ChatContainer />} />
      <Route path="/data" element={<DataList />} />
      {/* ... */}

      {/* 管理者専用ルート */}
      <Route element={<AdminRoute />}>
        <Route path="/admin" element={<AdminDashboard />} />
      </Route>
    </Route>
  </Route>
</Routes>
```

### 8. Lambda Function URL でJWT検証する

Lambda Function URLはCognito認証をビルトインでサポートしていないため、**自前でJWT検証が必要**。`aws-jwt-verify`ライブラリを使う方法もあるが、Web Crypto APIだけで実装できる。

```typescript
// amplify/functions/streaming-chat/handler.ts

// JWKS キャッシュ（コールドスタート後は再利用）
let jwksCache: { keys: JwkKey[] } | null = null

async function getJwks() {
  if (jwksCache) return jwksCache
  const userPoolId = getEnv('USER_POOL_ID')
  const region = userPoolId.split('_')[0]
  const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`
  const res = await fetch(url)
  jwksCache = (await res.json()) as { keys: JwkKey[] }
  return jwksCache
}

async function verifyJwt(token: string): Promise<string> {
  const { header, payload, signatureInput, signature } = decodeJwtParts(token)

  // クレームの検証
  const userPoolId = getEnv('USER_POOL_ID')
  const clientId = getEnv('USER_POOL_CLIENT_ID')
  const region = userPoolId.split('_')[0]
  const expectedIssuer =
    `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`

  if (payload.iss !== expectedIssuer) throw new Error('Invalid issuer')
  if (payload.token_use !== 'id') throw new Error('Invalid token_use')
  if (payload.client_id && payload.client_id !== clientId)
    throw new Error('Invalid client_id')
  if (payload.exp * 1000 < Date.now()) throw new Error('Token expired')

  // 署名の暗号学的検証
  const jwks = await getJwks()
  const jwk = jwks.keys.find((k) => k.kid === header.kid)
  if (!jwk) throw new Error('No matching JWK found')

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    new TextEncoder().encode(signatureInput),
  )
  if (!valid) throw new Error('Invalid signature')

  return payload.sub  // ユーザーID（Cognito sub）を返す
}
```

**なぜ外部ライブラリを使わないのか**:
- `aws-jwt-verify`は Node.js 依存が多く、Lambda のバンドルサイズが増える
- Web Crypto API は Lambda の Node.js 18+ でネイティブに利用可能
- 検証ロジックは50行程度で実装でき、依存ゼロで保守しやすい

**セキュリティ上の注意点**:
- `issuer`、`token_use`、`exp`（有効期限）、`client_id`を必ず検証する
- JWKSはキャッシュする（毎リクエストで取得するとレイテンシが増え、Cognitoへの負荷も発生する）
- `sub`（Cognito User ID）をユーザー識別子として使用する

### 9. フロントエンドからBearerトークンを送る

APIリクエスト時にCognitoのIDトークンをAuthorizationヘッダーに付与する。

```typescript
import { fetchAuthSession } from 'aws-amplify/auth'

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession()
  const token = session.tokens?.idToken?.toString()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// APIリクエスト例
const headers = await getAuthHeaders()
const response = await fetch(functionUrl, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(requestBody),
})
```

`fetchAuthSession`はCognitoのトークンリフレッシュも自動で行うため、期限切れトークンを送ってしまうリスクは低い。

## ポイント・注意点

### Cognitoエラーハンドリングの落とし穴

Cognitoのエラーは`Error.name`でハンドリングする（`Error.message`ではない）。`err.name === 'NotAuthorizedException'`のように判別し、日本語メッセージにマッピングするのが定石。

主要なエラー名:

| エラー名 | 発生タイミング | 意味 |
|----------|--------------|------|
| `NotAuthorizedException` | ログイン | パスワード不一致 |
| `UserNotFoundException` | ログイン/リセット | ユーザー未登録 |
| `UserNotConfirmedException` | ログイン | メール未確認 |
| `UsernameExistsException` | 登録 | メールアドレス重複 |
| `CodeMismatchException` | 確認/リセット | 確認コード不一致 |
| `ExpiredCodeException` | 確認/リセット | 確認コード期限切れ |
| `TooManyRequestsException` | 全般 | レート制限 |

### isLoading の初期値は true にする

`isLoading`を`false`で初期化すると、アプリ起動時に「未認証」と判定されてログイン画面が一瞬表示されるフラッシュが発生する。`true`で初期化し、`checkCurrentUser`完了後に`false`にすることでこれを防ぐ。

### import.meta.glob で amplify_outputs.json を安全にインポートする

Amplify Gen 2は`amplify_outputs.json`をgit ignoreするため、CI/CDやチームメンバーの環境でファイルが無い可能性がある。`import()`だとビルド時にエラーになるが、`import.meta.glob`なら空オブジェクトを返すだけで済む。

## まとめ

- `defineAuth({ loginWith: { email: true } })`の1行でCognito User Poolが完成する
- フロントエンドは`useAuth`フック + Zustandストアで、signIn/signUp/confirmSignUp/signOut/resetPasswordを統一管理
- 2ステップ登録（サインアップ→メール確認→自動ログイン）でUXを損なわない
- ProtectedRouteはReact RouterのOutletパターンで実装し、AdminRouteでロールベースのアクセス制御も追加できる
- Lambda Function URLではWeb Crypto APIで自前JWT検証。外部ライブラリ不要、50行で実装可能
- Cognitoエラーは`err.name`でハンドリングし、日本語メッセージにマッピングする

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> **Step 1: Amplify Auth定義**
> 「Amplify Gen 2プロジェクトにCognito認証を追加して。`amplify/auth/resource.ts`で`defineAuth`を使い、メールアドレスでのログインを有効にして。」
>
> **Step 2: Amplify設定の安全な読み込み**
> 「`src/lib/amplify.ts`に、`import.meta.glob`を使って`amplify_outputs.json`を安全に読み込む関数`configureAmplify`を作って。ファイルが無い場合はconsole.warnして`false`を返す。静的importではなくglob patternを使うこと（ビルドエラーを防ぐため）。」
>
> **Step 3: 認証ストアとフック**
> 「Zustandで`useAuthStore`を作って（user, isAuthenticated, isLoading）。`isLoading`の初期値は`true`にすること（起動時のフラッシュ防止）。次に`useAuth`フックを作り、`aws-amplify/auth`の`signIn`、`signUp`、`confirmSignUp`、`signOut`、`resetPassword`、`confirmResetPassword`、`getCurrentUser`、`fetchUserAttributes`をラップして。signIn成功後には`getCurrentUser` + `fetchUserAttributes`でユーザー属性を取得してストアに保存すること。」
>
> **Step 4: ログインフォームと登録フォーム**
> 「LoginFormを作って。メールとパスワードでサインインし、成功したら`location.state.from`にリダイレクト。Cognitoのエラーは`err.name`で判別して日本語メッセージにマッピング（NotAuthorizedException='パスワード不一致'、UserNotFoundException='未登録'等）。RegisterFormは2ステップ（register→confirm）で、確認コード入力後に自動でsignInすること。PasswordResetFormも同様に2ステップ。」
>
> **Step 5: ProtectedRouteとJWT検証**
> 「React RouterのOutletパターンで`ProtectedRoute`を作って。未認証なら`/login`にリダイレクト（`state: { from: location }`付き）。ローディング中は`LoadingSpinner`を表示。Lambda Function URLではWeb Crypto APIで自前JWT検証を実装して。CognitoのJWKSエンドポイントからキーを取得し、issuer・token_use・exp・client_idを検証。JWKSはモジュールスコープ変数にキャッシュ。`aws-jwt-verify`ライブラリは使わず、`crypto.subtle.importKey` + `crypto.subtle.verify`で署名を検証すること。」
>
> **注意点**: isLoadingの初期値を`true`にしないと、認証チェック完了前にログイン画面が一瞬表示される。Cognitoエラーは`err.message`ではなく`err.name`で判別する。
