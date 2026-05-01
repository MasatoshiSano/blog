---
title: "Amplify Gen 2のバックエンドでCognito JWTを検証する（第3回）— Lambda Function URLでの認証と監査ログ"
icon: "key"
type: "tech"
topics: ["Amplify", "Cognito", "Lambda", "JWT", "Auth"]
published: true
category: "HowTo"
date: "2026-03-01"
description: "Lambda Function URLでCognito JWTトークンを検証する実装方法を解説。JWKS取得・署名検証・クレーム検証のフルスクラッチ実装と、監査ログ統合まで"
series: "Amplify Gen 2でCognito認証を実装する"
seriesOrder: 3
coverImage: "/images/posts/amplify-gen2-cognito-auth-part3-cover.webp"
---

> **このシリーズ: 全3回**
> 1. [第1回: defineAuthからログインUIまで](/posts/amplify-gen2-cognito-auth-part1)
> 2. [第2回: 認証状態管理と保護ルート](/posts/amplify-gen2-cognito-auth-part2)
> 3. [第3回: バックエンドJWT検証と監査ログ](/posts/amplify-gen2-cognito-auth-part3) ← 今ここ

## 概要

[第1回](/posts/amplify-gen2-cognito-auth-part1)でCognitoの認証基盤を構築し、[第2回](/posts/amplify-gen2-cognito-auth-part2)でフロントエンドの認証状態管理を実装した。最終回では**バックエンド側の認証**を扱う。

Amplify Gen 2 の AppSync（GraphQL API）はCognitoと自動連携するので認証不要だが、**Lambda Function URL** を使う場合は自分でJWTを検証する必要がある。本記事では以下を解説する：

- `backend.ts` でCognito環境変数をLambdaに動的注入する方法
- Lambda内でCognito JWTをフルスクラッチで検証する実装
- フロントエンドからのトークン送信パターン
- 監査ログの統合

## こんな人向け

- Amplify Gen 2 の Lambda Function URL で認証を実装したい人
- Cognito JWTの検証ロジックを自前で書きたい（ライブラリに頼りたくない）人
- AppSync以外のエンドポイント（REST API、Function URL）でCognito認証を使いたい人
- 認証イベントの監査ログを残したい人

## 前提条件

- [第1回](/posts/amplify-gen2-cognito-auth-part1)、[第2回](/posts/amplify-gen2-cognito-auth-part2)の実装が完了していること
- Lambda関数が `amplify/functions/` に定義済み
- Node.js 20+（`crypto.subtle` が使えるランタイム）

## 手順

### 1. backend.ts — Cognito環境変数をLambdaに動的注入する

Lambda Function URL は AppSync と異なり、Cognito との自動連携がない。JWTを検証するにはUser Pool IDとClient IDが必要だが、Amplify Gen 2ではこれらの値はデプロイ時に動的に決まるため、ハードコーディングできない。

解決策は `backend.ts` で CDK レベルのリソース参照を使い、環境変数として注入すること。

```typescript
// amplify/backend.ts
import { defineBackend } from '@aws-amplify/backend'
import { FunctionUrlAuthType, HttpMethod, InvokeMode } from 'aws-cdk-lib/aws-lambda'
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda'
import { auth } from './auth/resource'
import { streamingChat } from './functions/streaming-chat/resource'

const backend = defineBackend({ auth, streamingChat })

// Cognito リソースへの参照を取得
const userPool = backend.auth.resources.userPool
const userPoolClient = backend.auth.resources.cfnResources.cfnUserPoolClient

// Lambda 関数への参照
const streamingLambda = backend.streamingChat.resources.lambda as LambdaFunction

// Function URL を設定（レスポンスストリーミング有効）
const fnUrl = streamingLambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,  // JWT検証を自前で行うため
  invokeMode: InvokeMode.RESPONSE_STREAM,
  cors: {
    allowedOrigins: ['https://your-app.amplifyapp.com', 'http://localhost:5173'],
    allowedHeaders: ['content-type', 'authorization'],
    allowedMethods: [HttpMethod.POST],
  },
})

// Cognito 環境変数を動的に注入
streamingLambda.addEnvironment('USER_POOL_ID', userPool.userPoolId)
streamingLambda.addEnvironment('USER_POOL_CLIENT_ID', userPoolClient.ref)
```

#### なぜ `authType: FunctionUrlAuthType.NONE` なのか

直感に反するが、これで正しい。選択肢は以下の2つ:

| authType | 動作 | 用途 |
|----------|------|------|
| `NONE` | 誰でもURLにアクセス可能。認証はアプリケーション層で行う | ブラウザから直接呼ぶ場合（CORS + JWT検証） |
| `AWS_IAM` | IAM署名（SigV4）が必要 | バックエンド間通信。ブラウザからは使いにくい |

ブラウザから Lambda Function URL を呼ぶ場合、`AWS_IAM` だとSigV4署名が必要になり実装が複雑化する。`NONE` にしてCORS + JWT検証で認証する方がシンプルだ。

#### ポイント: CORS の `allowedHeaders` に `authorization` を含める

これを忘れるとブラウザのプリフライトリクエスト（OPTIONS）で `Authorization` ヘッダーが拒否され、認証が常に失敗する。地味だが最もハマりやすいポイント。

### 2. Lambda内でCognito JWTを検証する

JWT検証の全体フローは以下の通り:

```
Authorization: Bearer <token>
  ↓
1. JWTをデコード（ヘッダー、ペイロード、署名）
  ↓
2. クレーム検証
  ├─ issuer: Cognito User Pool のURL
  ├─ token_use: "id"（IDトークン）
  ├─ client_id: User Pool Client ID
  └─ exp: 現在時刻より未来
  ↓
3. JWKS取得（Cognito公開鍵）
  ↓
4. JWKから公開鍵をインポート（Web Crypto API）
  ↓
5. RSA-SHA256で署名検証
  ↓
6. 検証成功 → payload.sub（ユーザーID）を返す
```

#### 2a. 型定義

```typescript
interface JwkKey {
  kid: string  // Key ID
  kty: string  // Key Type (RSA)
  n: string    // Modulus
  e: string    // Exponent
  alg: string  // Algorithm (RS256)
  use: string  // Usage (sig)
}

interface JwksResponse {
  keys: JwkKey[]
}

interface JwtHeader {
  kid: string
  alg: string
}

interface JwtPayload {
  sub: string       // Subject（ユーザーID）
  iss: string       // Issuer（Cognito URL）
  client_id?: string
  token_use: string // "id" or "access"
  exp: number       // Expiration（Unix timestamp）
}
```

#### 2b. JWKS取得（キャッシュ付き）

Cognito User Pool は公開鍵を JWKS（JSON Web Key Set）エンドポイントで提供している。Lambda のコールドスタート時に取得し、以降はキャッシュする。

```typescript
let cachedJwks: JwksResponse | null = null

async function getJwks(): Promise<JwksResponse> {
  if (cachedJwks) return cachedJwks

  const userPoolId = getEnv('USER_POOL_ID')
  const region = userPoolId.split('_')[0]  // "ap-northeast-1_xxx" → "ap-northeast-1"
  const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`)

  cachedJwks = (await res.json()) as JwksResponse
  return cachedJwks
}
```

#### ハマりポイント: User Pool ID からリージョンを抽出する

User Pool ID は `ap-northeast-1_xxxxxxxx` の形式で、アンダースコアの前がリージョン名になる。これをハードコーディングすると、マルチリージョンデプロイ時に壊れる。`split('_')[0]` で動的に抽出する。

#### 2c. JWTデコード

```typescript
function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = Buffer.from(padded, 'base64')
  return new Uint8Array(binary)
}

function decodeJwtParts(token: string): {
  header: JwtHeader
  payload: JwtPayload
  signatureInput: string
  signature: Uint8Array
} {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')

  const header = JSON.parse(
    Buffer.from(parts[0], 'base64url').toString()
  ) as JwtHeader

  const payload = JSON.parse(
    Buffer.from(parts[1], 'base64url').toString()
  ) as JwtPayload

  const signatureInput = `${parts[0]}.${parts[1]}`
  const signature = base64UrlDecode(parts[2])

  return { header, payload, signatureInput, signature }
}
```

#### 2d. 署名検証（Web Crypto API）

Node.js 20+ のLambdaランタイムでは `crypto.subtle`（Web Crypto API）がグローバルで使える。外部ライブラリ不要でRSA署名検証が可能だ。

```typescript
async function importJwk(jwk: JwkKey) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

async function verifyJwt(token: string): Promise<string> {
  const { header, payload, signatureInput, signature } = decodeJwtParts(token)

  // 1. クレーム検証
  const userPoolId = getEnv('USER_POOL_ID')
  const clientId = getEnv('USER_POOL_CLIENT_ID')
  const region = userPoolId.split('_')[0]
  const expectedIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`

  if (payload.iss !== expectedIssuer) {
    throw new Error('Invalid issuer')
  }
  if (payload.token_use !== 'id') {
    throw new Error('Invalid token_use: expected id token')
  }
  if (payload.client_id && payload.client_id !== clientId) {
    throw new Error('Invalid client_id')
  }
  if (payload.exp * 1000 < Date.now()) {
    throw new Error('Token expired')
  }

  // 2. 署名検証
  const jwks = await getJwks()
  const jwk = jwks.keys.find((k) => k.kid === header.kid)
  if (!jwk) throw new Error('No matching JWK found')

  const cryptoKey = await importJwk(jwk)
  const encoder = new TextEncoder()
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    encoder.encode(signatureInput),
  )
  if (!valid) throw new Error('Invalid JWT signature')

  // 検証成功 → ユーザーID を返す
  return payload.sub
}
```

#### なぜライブラリ（jsonwebtoken等）を使わないのか

`jsonwebtoken` や `jose` などのライブラリを使うこともできるが、以下の理由で自前実装を選んだ:

1. **バンドルサイズ**: Lambda のコールドスタートに影響する。Web Crypto API はネイティブなので追加コスト0
2. **依存関係の削減**: `jsonwebtoken` は `node-forge` などの依存を持ち、Lambda Layer が必要になることがある
3. **理解の透明性**: JWTの仕組みを理解した上でコードを書くことで、デバッグ時に何が起きているか分かる

ただし、チームの経験レベルやメンテナンス性を考慮して `jose`（Pure ESM、依存関係なし）を使うのも良い選択だ。

### 3. Lambda ハンドラーでの認証チェック

```typescript
// Lambda Function URL ハンドラー（抜粋）
export const handler = async (event: FunctionUrlEvent) => {
  // Authorization ヘッダーの取得
  const authHeader =
    event.headers['authorization'] ?? event.headers['Authorization']

  if (!authHeader?.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Missing or invalid Authorization header' }),
    }
  }

  // JWT 検証
  let userId: string
  try {
    userId = await verifyJwt(authHeader.slice(7))
  } catch (err) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        error: `JWT verification failed: ${(err as Error).message}`,
      }),
    }
  }

  // userId を使ってビジネスロジックを実行
  // セッションの所有権チェックなど
  const session = await getSession(sessionId)
  if (session.userId !== userId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  // ... 以降のビジネスロジック
}
```

#### ポイント: ヘッダー名の大文字/小文字

Lambda Function URL では HTTP ヘッダー名が小文字に正規化される仕様だが、念のため `authorization` と `Authorization` の両方をチェックする。API Gateway 経由の場合は元の大文字小文字が維持されるため、両方対応しておくと安全。

### 4. フロントエンドからのトークン送信

フロントエンド側では `aws-amplify/auth` の `fetchAuthSession` でIDトークンを取得し、`Authorization` ヘッダーに付与する。

```typescript
// src/features/chat/hooks/useStreamingChat.ts（抜粋）
import { fetchAuthSession } from 'aws-amplify/auth'

async function callStreamingEndpoint(sessionId: string, content: string) {
  // Cognito IDトークンを取得
  const session = await fetchAuthSession()
  const idToken = session.tokens?.idToken?.toString()

  if (!idToken) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(STREAMING_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ sessionId, content }),
  })

  // ... レスポンス処理
}
```

`fetchAuthSession()` はCognitoのトークンを自動更新してくれるため、リフレッシュトークンの期限内であればトークン期限切れの心配はない。

### 5. 監査ログの統合

認証イベント（ログイン、ログアウト、失敗）を監査ログに記録する。

```typescript
// src/shared/utils/auditLogger.ts
import { getAmplifyClient } from '@/lib/amplifyClient'
import type { AuditAction, AuditResourceType } from '@/types'

interface LogAuditEventParams {
  userId: string
  userEmail: string
  action: AuditAction
  resourceType: AuditResourceType
  resourceId?: string
  metadata?: Record<string, string>
}

/**
 * Fire-and-forget 監査ログ。
 * 認証フローをブロックしないよう、エラーは握りつぶしてconsoleに出力するだけ。
 */
export async function logAuditEvent(params: LogAuditEventParams): Promise<void> {
  try {
    const client = getAmplifyClient()
    await client.models.AuditLog.create({
      userId: params.userId,
      userEmail: params.userEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[AuditLogger] Failed to write audit log:', err)
  }
}
```

`useAuth` フック内でログイン成功時に呼び出す:

```typescript
// useAuth.ts の signIn 内
const updatedUser = await checkCurrentUser()
if (updatedUser) {
  void logAuditEvent({
    userId: updatedUser.id,
    userEmail: updatedUser.email,
    action: 'LOGIN',
    resourceType: 'Auth',
  })
}
```

#### 設計判断: なぜ fire-and-forget なのか

監査ログの書き込みを `await` して失敗でログインをブロックするのは本末転倒だ。`void` で呼び出し、失敗はコンソールに記録するだけにする。監査ログの信頼性を高めたい場合は、SQS/EventBridgeなどの非同期パイプラインを検討する。

## ポイント・注意点

### JWKSキャッシュの注意点

Lambda関数内でJWKSをキャッシュしているが、Cognitoがキーをローテーションした場合、古いキャッシュが原因で検証が失敗する可能性がある。運用では以下のフォールバックを入れるとより堅牢:

```typescript
async function verifyJwtWithFallback(token: string): Promise<string> {
  try {
    return await verifyJwt(token)
  } catch (err) {
    // キャッシュをクリアしてリトライ
    cachedJwks = null
    return await verifyJwt(token)
  }
}
```

### IDトークン vs アクセストークン

Cognitoは2種類のJWTを発行する:

| トークン | `token_use` | 用途 |
|----------|-------------|------|
| **IDトークン** | `id` | ユーザー属性（email, name等）を含む。フロントエンド→バックエンドの認証に使う |
| **アクセストークン** | `access` | APIへのアクセス制御。Cognito User Pool APIの呼び出しに使う |

この実装ではIDトークンを使用している（`token_use === 'id'` で検証）。

### セキュリティの考慮事項

- **CORS設定**: `allowedOrigins` は本番ドメインのみに限定する。`*` は絶対に使わない
- **エラーメッセージ**: JWT検証失敗のエラー詳細をレスポンスに含めているが、本番では `Invalid token` 程度に抑えるべき（攻撃者に情報を与えない）
- **トークン期限**: CognitoのIDトークンは1時間が上限。`fetchAuthSession()` がリフレッシュを自動処理する

## まとめ

- `backend.ts` で `userPool.userPoolId` と `userPoolClient.ref` をLambda環境変数に動的注入する
- JWT検証はWeb Crypto APIでフルスクラッチ実装可能。外部ライブラリ不要
- JWKS（公開鍵）はLambda内でキャッシュし、コールドスタートのコストを最小化
- フロントエンドは `fetchAuthSession()` でIDトークンを取得し、`Authorization: Bearer` で送信
- 監査ログは fire-and-forget で認証フローをブロックしない

このシリーズを通じて、Amplify Gen 2 + Cognitoによる認証の全レイヤー（バックエンド定義 → フロントエンドUI → 状態管理 → バックエンド検証）を実装した。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> Amplify Gen 2プロジェクトのLambda Function URLにCognito JWT認証を追加してください。
>
> 要件:
> - `backend.ts` で `backend.auth.resources.userPool.userPoolId` と `backend.auth.resources.cfnResources.cfnUserPoolClient.ref` をLambda環境変数（USER_POOL_ID, USER_POOL_CLIENT_ID）に注入
> - Function URL は `authType: NONE` で、CORS の `allowedHeaders` に `authorization` を含める
> - Lambda ハンドラー内で JWT 検証関数を実装:
>   - JWKS を `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json` から取得してキャッシュ
>   - `crypto.subtle`（Web Crypto API）で RSA-SHA256 署名を検証
>   - クレーム検証: issuer, token_use="id", client_id, exp
>   - 検証成功で `payload.sub`（ユーザーID）を返す
> - フロントエンドは `fetchAuthSession()` でIDトークン取得、`Authorization: Bearer {token}` で送信
>
> 注意点:
> - `jsonwebtoken` 等のライブラリは使わず、Web Crypto API のみで実装する
> - User Pool ID のフォーマットは `{region}_{id}` なので、リージョンは `split('_')[0]` で抽出する
> - JWKS キャッシュはモジュールスコープの変数で Lambda 実行環境間で再利用される
> - CORS に `authorization` ヘッダーを含めないとブラウザのプリフライトが失敗する

### エージェントに指示するときの注意点

- **`backend.ts` のCDK操作とLambdaハンドラーは別ファイル**: この2つを一度に指示すると、エージェントがCDKコードをLambda内に書いてしまうことがある。ファイルパスを明示する
- **`authType: NONE` の理由を説明する**: 理由を書かないと「セキュリティ的に `AWS_IAM` にすべき」と勝手に変更されることがある
- **Web Crypto API を強調する**: 指定しないと `jsonwebtoken` を `npm install` しようとする。Node.js 20+ では不要であることを明記する

---

これで「Amplify Gen 2でCognito認証を実装する」シリーズは完結です。第1回から順に読むことで、バックエンド定義からフロントエンドUI、状態管理、バックエンドJWT検証まで一貫した理解が得られます。
