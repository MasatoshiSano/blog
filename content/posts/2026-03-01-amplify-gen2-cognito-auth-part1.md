---
title: "Amplify Gen 2でCognito認証を最短構築する（第1回）— defineAuth 1行からログインUIまで"
emoji: "🔐"
type: "tech"
topics: ["Amplify", "Cognito", "React", "AWS", "Auth"]
published: true
category: "HowTo"
date: "2026-03-01"
description: "AWS Amplify Gen 2のdefineAuthを使い、Cognito認証のバックエンド構築からReactログインUI実装までを一気通貫で解説。メール認証・パスワードリセットまでカバー"
series: "Amplify Gen 2でCognito認証を実装する"
seriesOrder: 1
coverImage: "/images/posts/amplify-gen2-cognito-auth-part1-cover.jpg"
---

> **このシリーズ: 全3回**
> 1. [第1回: defineAuthからログインUIまで](/posts/amplify-gen2-cognito-auth-part1) ← 今ここ
> 2. [第2回: 認証状態管理と保護ルート](/posts/amplify-gen2-cognito-auth-part2)
> 3. [第3回: バックエンドJWT検証と監査ログ](/posts/amplify-gen2-cognito-auth-part3)

## 概要

AWS Amplify Gen 2 は、TypeScriptでインフラをコードとして定義する「コード・ファースト」なDXを提供する。中でもCognito認証の構築は驚くほどシンプルで、`defineAuth` の数行でユーザープール・IDプール・認証フローが丸ごと立ち上がる。

この記事では、**defineAuthの設定からReactでのログイン・登録・パスワードリセットUIの実装まで**をステップバイステップで解説する。Amplify UI (`@aws-amplify/ui-react`) の `Authenticator` コンポーネントは使わず、自前のフォームで実装する方法を採る。理由は、UIの自由度とブランドデザインへの統合が容易になるためだ。

## こんな人向け

- Amplify Gen 2でCognito認証を初めて導入する人
- `@aws-amplify/ui-react` の `Authenticator` を使わず、自前のログインUIを作りたい人
- Cognito固有のエラーハンドリングで困っている人
- メール確認・パスワードリセットフローの実装方法を知りたい人

## 前提条件

- Node.js 18+
- React 19+ / TypeScript 5+
- Amplify Gen 2 CLI（`@aws-amplify/backend-cli`）がインストール済み
- AWSアカウントが設定済み

```bash
npm install aws-amplify @aws-amplify/backend @aws-amplify/backend-cli
```

## 手順

### 1. defineAuth — バックエンドの認証リソースを定義する

Amplify Gen 2 では `amplify/auth/resource.ts` に認証リソースを定義する。驚くべきことに、メール認証のセットアップはたった数行で完了する。

```typescript
// amplify/auth/resource.ts
import { defineAuth } from '@aws-amplify/backend'

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
})
```

これだけで以下が自動生成される：

- **Cognito User Pool** — パスワードポリシー（8文字以上、大文字・小文字・数字・記号必須）
- **User Pool Client** — SRPフローが有効化されたアプリクライアント
- **Identity Pool** — 未認証アクセスも含む一時的AWS認証情報の発行
- **メール確認フロー** — サインアップ時に確認コードが自動送信される

#### なぜ `Authenticator` コンポーネントを使わないのか

Amplify UIの `Authenticator` コンポーネントは手軽だが、以下の理由から自前実装を選んだ:

1. **デザインシステムとの統合**: 独自のコンポーネントライブラリ（この例ではSerendie Design System）を使いたい場合、Authenticatorのスタイルオーバーライドは限界がある
2. **エラーメッセージの日本語化**: Authenticatorのデフォルトエラーメッセージは英語で、カスタマイズが煩雑
3. **フロー制御**: 確認コード入力後の自動ログインなど、細かいフロー制御を入れたい

### 2. バックエンドにAuthを登録する

`amplify/backend.ts` で他のリソースと一緒にAuthを登録する。

```typescript
// amplify/backend.ts
import { defineBackend } from '@aws-amplify/backend'
import { auth } from './auth/resource'
import { data } from './data/resource'

const backend = defineBackend({
  auth,
  data,
  // ... 他のリソース
})
```

`npx ampx sandbox` を実行すると、CloudFormationでCognitoリソースがデプロイされ、`amplify_outputs.json` が自動生成される。このファイルにUser Pool ID、Client ID、Identity Pool IDなどの接続情報が含まれる。

### 3. フロントエンドでAmplifyを初期化する

アプリのエントリーポイントで `amplify_outputs.json` を読み込んでAmplifyを設定する。

```typescript
// src/lib/amplify.ts
import { Amplify } from 'aws-amplify'

export async function configureAmplify(): Promise<boolean> {
  // Viteの動的インポートで amplify_outputs.json を読み込む
  const modules = import.meta.glob<Record<string, unknown>>(
    '/amplify_outputs.json',
    { eager: false },
  )
  const loader = modules['/amplify_outputs.json']

  if (!loader) {
    console.warn('amplify_outputs.json not found...')
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

#### ポイント: なぜ動的インポートなのか

`import outputs from '../amplify_outputs.json'` と静的にインポートすることもできるが、動的インポートを使う理由は:

- **ビルド時にファイルが存在しなくてもエラーにならない**: CI/CDでテストを先に回す場合、`amplify_outputs.json` はまだ生成されていない可能性がある
- **グレースフルデグラデーション**: ファイルがなければ `false` を返し、アプリは認証なしモードで動作可能

エントリーポイントで呼び出す：

```typescript
// src/main.tsx
import { configureAmplify } from './lib/amplify'

async function bootstrap() {
  await configureAmplify()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
}

void bootstrap()
```

### 4. useAuth — 認証操作のカスタムフック

Amplifyの認証APIをラップしたカスタムフックを作る。これが認証UIの土台になる。

```typescript
// src/features/auth/hooks/useAuth.ts
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
  const { setUser, setLoading, clear } = useAuthStore()

  const checkCurrentUser = useCallback(async () => {
    try {
      setLoading(true)
      const { userId } = await getCurrentUser()
      const attributes = await fetchUserAttributes()

      const currentUser: User = {
        id: userId,
        email: attributes.email ?? '',
        displayName: attributes.name ?? attributes.email ?? '',
        role: 'MEMBER',
        language: 'ja',
        displayTheme: 'system',
        createdAt: '',
        updatedAt: '',
      }
      setUser(currentUser)
      return currentUser
    } catch {
      clear()
      return null
    }
  }, [setUser, setLoading, clear])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await amplifySignIn({ username: email, password })
      if (result.isSignedIn) {
        return await checkCurrentUser()
      }
      return null
    },
    [checkCurrentUser],
  )

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      await amplifySignUp({
        username: email,
        password,
        options: {
          userAttributes: { name: displayName },
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

  const resetPassword = useCallback(async (email: string) => {
    await amplifyResetPassword({ username: email })
  }, [])

  const confirmResetPassword = useCallback(
    async (email: string, code: string, newPassword: string) => {
      await amplifyConfirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword,
      })
    },
    [],
  )

  return {
    checkCurrentUser,
    signIn,
    signUp,
    confirmSignUp,
    signOut,
    resetPassword,
    confirmResetPassword,
  }
}
```

### 5. ログインフォームの実装

```tsx
// src/features/auth/components/LoginForm.tsx
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useAuth } from '../hooks/useAuth'

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

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from = (location.state as { from?: Location })?.from?.pathname ?? '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const user = await signIn(email, password)
      if (user) {
        navigate(from, { replace: true })
      }
    } catch (err) {
      const errorName = (err as { name?: string }).name ?? ''
      setError(getErrorMessage(errorName))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error-message">{error}</div>}
      <div>
        <label htmlFor="email">メールアドレス</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor="password">パスワード</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'ログイン中...' : 'ログイン'}
      </button>
      <a href="/password-reset">パスワードを忘れた方</a>
      <a href="/register">アカウント作成</a>
    </form>
  )
}
```

#### ハマりポイント: Cognitoエラーの `name` プロパティ

Cognito SDKが投げるエラーは `name` プロパティにエラー種別が入る。`message` ではなく `name` でスイッチする点に注意。よくあるエラー名：

| エラー名 | 発生タイミング |
|----------|----------------|
| `NotAuthorizedException` | パスワード不一致 |
| `UserNotFoundException` | 未登録メールアドレス |
| `UserNotConfirmedException` | メール未確認 |
| `UsernameExistsException` | 登録済みメールで再登録 |
| `InvalidPasswordException` | パスワードポリシー違反 |
| `CodeMismatchException` | 確認コード不一致 |
| `ExpiredCodeException` | 確認コード期限切れ |
| `LimitExceededException` | レート制限 |

### 6. 登録フォーム — 2段階フロー

Cognito のサインアップは「登録 → メール確認」の2段階になる。これをステートで管理する。

```tsx
// src/features/auth/components/RegisterForm.tsx（抜粋）
type RegisterStep = 'register' | 'confirm'

export function RegisterForm() {
  const [step, setStep] = useState<RegisterStep>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const { signUp, confirmSignUp, signIn } = useAuth()

  // ステップ1: 登録
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await signUp(email, password, displayName)
      setStep('confirm') // メール確認ステップへ
    } catch (err) {
      // エラーハンドリング
    }
  }

  // ステップ2: メール確認 → 自動ログイン
  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await confirmSignUp(email, confirmCode)
      // 確認後に自動でログイン
      await signIn(email, password)
      navigate('/')
    } catch (err) {
      // エラーハンドリング
    }
  }

  if (step === 'confirm') {
    return (
      <form onSubmit={handleConfirm}>
        <p>{email} に確認コードを送信しました。</p>
        <input
          value={confirmCode}
          onChange={(e) => setConfirmCode(e.target.value)}
          placeholder="確認コード"
        />
        <button type="submit">確認</button>
      </form>
    )
  }

  return (
    <form onSubmit={handleRegister}>
      <input value={displayName} onChange={...} placeholder="表示名" />
      <input value={email} onChange={...} placeholder="メール" type="email" />
      <input value={password} onChange={...} placeholder="パスワード" type="password" />
      <button type="submit">アカウント作成</button>
    </form>
  )
}
```

#### 設計判断: 確認後の自動ログイン

メール確認後に再度ログインフォームに飛ばすのはUXが悪い。`confirmSignUp` 成功後にそのまま `signIn` を呼ぶことで、ユーザーは一度もログインフォームを見ずにアプリに入れる。パスワードは `useState` で保持しているので、そのまま使える。

### 7. パスワードリセットフォーム — 同じく2段階

```tsx
// src/features/auth/components/PasswordResetForm.tsx（抜粋）
type ResetStep = 'request' | 'confirm'

export function PasswordResetForm() {
  const [step, setStep] = useState<ResetStep>('request')
  const { resetPassword, confirmResetPassword } = useAuth()

  // ステップ1: リセットコード送信
  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    await resetPassword(email)
    setStep('confirm')
  }

  // ステップ2: 新パスワード設定
  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    await confirmResetPassword(email, code, newPassword)
    navigate('/login')
  }

  // ... フォームのレンダリング
}
```

## ポイント・注意点

### amplify_outputs.json はgitに入れるべきか？

`amplify_outputs.json` には User Pool ID やリージョン情報が含まれるが、**シークレットではない**。これらはフロントエンドのJavaScriptバンドルにも含まれる公開情報だ。Amplify公式ドキュメントでもリポジトリにコミットすることを推奨している。ただし、`.env` にAPIキーなどの本当のシークレットを入れている場合は `.gitignore` に追加すること。

### パスワードポリシーのカスタマイズ

`defineAuth` のデフォルトでは厳しめのパスワードポリシー（8文字以上、大文字・小文字・数字・記号すべて必須）が適用される。緩和したい場合は `defineAuth` のオプションで指定できるが、セキュリティとのトレードオフを慎重に検討すべきだ。

### MFAの追加

この記事ではMFAを無効にしているが、`defineAuth` に `multifactor` オプションを追加するだけでTOTP（Google Authenticator等）やSMS MFAを有効化できる。

## まとめ

- Amplify Gen 2の `defineAuth` はたった数行でCognitoの認証基盤を構築できる
- `Authenticator` コンポーネントを使わず自前のUIを実装することで、デザインシステムへの統合とエラーメッセージの日本語化が自由にできる
- Cognitoの2段階フロー（登録→確認、リセット→確認）はステート管理で自然に表現できる
- エラーハンドリングは `name` プロパティで分岐するのがポイント

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> React + TypeScript + Amplify Gen 2プロジェクトにCognito認証を追加してください。
>
> 要件:
> - `amplify/auth/resource.ts` に `defineAuth({ loginWith: { email: true } })` を定義
> - `amplify/backend.ts` に auth リソースを登録
> - `src/lib/amplify.ts` で `amplify_outputs.json` を動的インポートして `Amplify.configure()` を実行（ファイルが存在しない場合はgraceful fallback）
> - `@aws-amplify/ui-react` の Authenticator は使わず、自前のフォームで実装
> - `useAuth` カスタムフックで signIn / signUp / confirmSignUp / signOut / resetPassword / confirmResetPassword を提供
> - ログインフォーム: メール/パスワード入力、Cognitoエラーを日本語メッセージに変換（NotAuthorizedException, UserNotFoundException 等）
> - 登録フォーム: 2段階（登録→確認コード入力）、確認後に自動ログイン
> - パスワードリセット: 2段階（メール送信→コード+新パスワード）
>
> 注意点:
> - Cognitoのエラーは `err.name` で分岐する（`err.message` ではない）
> - `signUp` 時に `userAttributes: { name: displayName }` でCognito属性にdisplayNameを保存
> - `confirmSignUp` 後にパスワードを再利用して自動ログインする

### エージェントに指示するときの注意点

- **バックエンドとフロントエンドを分けて指示する**: `defineAuth` の設定と React の UI実装を一度に指示すると、混乱しやすい。まずバックエンドリソース定義、次にフロントエンド実装と2回に分ける
- **`Authenticator` を使わないことを明示する**: 指示が曖昧だとエージェントは `@aws-amplify/ui-react` の `Authenticator` を使おうとする。「自前のフォームで実装」と明確に指定する
- **2段階フローのステート管理を具体的に指示する**: 「登録後にメール確認」と書くだけでは、ページ遷移で実装されることがある。「同一コンポーネント内でステートを切り替える」と指定する

---

次回: [第2回: 認証状態管理と保護ルート](/posts/amplify-gen2-cognito-auth-part2) では、Zustandで認証状態を管理し、React Routerで保護ルートを実装する方法を解説します。
