---
title: "WebSocket Lambdaの実装 — JWT認証・ブロードキャスト・切断処理"
emoji: "🔐"
type: "tech"
topics: ["AWS", "Lambda", "WebSocket", "Cognito", "TypeScript"]
published: true
category: "HowTo"
date: "2026-03-01"
description: "API Gateway WebSocket APIのLambdaハンドラー実装を解説。$connectでのCognito JWT検証、sendMessageでの全員配信とGoneException処理、$disconnectでの接続レコード削除まで"
series: "AWSサーバーレスチャット実装"
seriesOrder: 4
coverImage: "/images/posts/aws-serverless-chat-part4-cover.jpg"
---

> **このシリーズ: 全5回**
> 1. [第1回: リアルタイム通信の選択肢 — ポーリング・SSE・WebSocketを比較する](/posts/aws-serverless-chat-part1)
> 2. [第2回: DynamoDB Single Table Designでチャットを設計する](/posts/aws-serverless-chat-part2)
> 3. [第3回: CDKでWebSocket APIを構築する](/posts/aws-serverless-chat-part3)
> 4. WebSocket Lambdaの実装 — JWT認証・ブロードキャスト・切断処理 ← 今ここ
> 5. [第5回: ReactでリアルタイムチャットUIを作る](/posts/aws-serverless-chat-part5)

## 概要

前回はCDKでWebSocket APIのインフラを定義した。今回は、そのAPIの裏側で動く **4つのLambda関数** の実装を解説する。

- **connect.ts** — JWT検証と接続レコードの保存
- **disconnect.ts** — 接続レコードの削除
- **sendMessage.ts** — メッセージ保存と全参加者へのブロードキャスト
- **default.ts** — 未知のアクションのハンドリング

特に `sendMessage.ts` は、認証チェック・参加者検証・メッセージ保存・全員配信・切断済み接続の掃除と、多くの責務を1つの関数で処理する。ハマりやすいポイントを中心に解説する。

## こんな人向け

- WebSocket Lambda関数のイベント構造を理解したい
- WebSocketでCognito認証をどう実現するか知りたい
- `ApiGatewayManagementApiClient` の使い方が分からない
- `GoneException` の意味と対処法を知りたい

## $connect — 接続時の認証

### WebSocket認証の独特さ

REST APIでは `Authorization: Bearer <token>` ヘッダーで認証する。しかしWebSocket APIでは、**ブラウザの `WebSocket` APIがカスタムヘッダーを送れない**。

```typescript
// ❌ これはできない（ブラウザのWebSocket APIの制限）
const ws = new WebSocket('wss://...', {
  headers: { Authorization: 'Bearer xxx' }  // サポートされていない
});

// ✅ クエリパラメータでトークンを渡す
const ws = new WebSocket('wss://...?token=eyJhbGciOi...');
```

そのため、**`$connect` ルートでクエリパラメータからトークンを取得してLambda内で検証する** パターンが一般的。

### connect.ts の実装

```typescript
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const CLIENT_ID = process.env.CLIENT_ID!;

// Cognito JWT検証器（コールドスタート時に1回だけ初期化）
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',       // IDトークンを検証
  clientId: CLIENT_ID,
});
```

**`aws-jwt-verify` ライブラリ**: AWSが公式に提供するCognito JWT検証ライブラリ。JWKSの取得・キャッシュ・署名検証を自動的に行ってくれる。自前でJWT検証ロジックを書く必要がない。

```typescript
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // クエリパラメータからトークンを取得
  const queryStringParameters = (event as Record<string, unknown>)
    .queryStringParameters as Record<string, string> | undefined;
  const token = queryStringParameters?.token;

  if (!token) {
    return { statusCode: 401, body: 'Unauthorized: No token' };
  }

  let userId: string;
  try {
    const payload = await verifier.verify(token);
    userId = payload.sub;  // Cognito User PoolのユーザーID
  } catch (error) {
    return { statusCode: 401, body: 'Unauthorized: Invalid token' };
  }
```

**重要: `$connect` で401を返すと接続自体が拒否される**。REST APIと違い、一度接続が確立された後のメッセージには `$connect` は呼ばれない。つまり認証は接続時の1回きり。

```typescript
  const now = new Date().toISOString();

  // ① CONNECTION#レコード（connectionId → userId の正引き）
  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CONNECTION#${connectionId}`,
        SK: 'METADATA',
        Type: 'Connection',
        connectionId,
        userId,
        connectedAt: now,
        ttl: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  // ② USER#レコード（userId → connectionId の逆引き）
  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${userId}`,
        SK: `CONNECTION#${connectionId}`,
        Type: 'UserConnection',
        connectionId,
        connectedAt: now,
        ttl: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  return { statusCode: 200, body: 'Connected' };
};
```

前回の記事で設計した **双方向レコード** を書き込む。接続のたびに2レコードが作成される。

## $disconnect — 切断処理

```typescript
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // CONNECTION#レコードからuserIdを取得
  const queryResult = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `CONNECTION#${connectionId}`,
      },
    })
  );

  const connection = queryResult.Items?.[0];
  if (!connection) {
    return { statusCode: 200, body: 'OK' };
  }

  const userId = connection.userId;

  // 双方向レコードを両方削除
  await ddbDocClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CONNECTION#${connectionId}`, SK: 'METADATA' },
    })
  );

  if (userId) {
    await ddbDocClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `CONNECTION#${connectionId}` },
      })
    );
  }

  return { statusCode: 200, body: 'Disconnected' };
};
```

**`$disconnect` は必ず呼ばれるとは限らない**: ネットワーク障害やブラウザクラッシュの場合、API Gatewayが切断を検知するまでタイムラグがある（最大10分程度）。そのため、`$connect` でTTL（24h）を設定して保険をかけている。

## sendMessage — メッセージ配信の中核

### 全体のフロー

```
1. connectionIdからsenderIdを特定
2. 送信者の本人確認ステータスをチェック
3. チャットルームの存在と参加者検証
4. メッセージの長さバリデーション
5. DynamoDBにメッセージを保存
6. LASTMESSAGEキャッシュを更新
7. 全参加者のアクティブ接続を取得
8. 全接続にメッセージをブロードキャスト
9. 切断済み接続（GoneException）をクリーンアップ
```

### ApiGatewayManagementApiClient

Lambda関数からWebSocket接続中のクライアントにメッセージを送信するには、`ApiGatewayManagementApiClient` を使う:

```typescript
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

// endpointはイベントから動的に構築
const domain = event.requestContext.domainName;
const stage = event.requestContext.stage;

const apiGatewayClient = new ApiGatewayManagementApiClient({
  endpoint: `https://${domain}/${stage}`,
});
```

**`endpoint` を動的に構築する理由**: ハードコードすると環境ごと（dev/prod）にコードを変える必要がある。`event.requestContext` から取得すれば環境を問わず動作する。

### ブロードキャストの実装

```typescript
// 全参加者のアクティブ接続を収集
const connections: string[] = [];
for (const participantId of participantIds) {
  const userConnections = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${participantId}`,
        ':sk': 'CONNECTION#',
      },
    })
  );

  if (userConnections.Items) {
    connections.push(
      ...userConnections.Items.map((item) => item.connectionId as string)
    );
  }
}
```

ここで第2回で設計した **USER → CONNECTION の逆引きレコード** が活きる。各参加者のアクティブ接続を1回のQueryで取得できる。

```typescript
// 全接続に並列送信
const messageData = JSON.stringify({
  type: 'message',
  data: {
    messageId,
    chatRoomId,
    senderId,
    content,
    messageType: 'user',
    createdAt: now,
    timestamp,
  },
});

await Promise.allSettled(
  connections.map(async (connId) => {
    try {
      await apiGatewayClient.send(
        new PostToConnectionCommand({
          ConnectionId: connId,
          Data: Buffer.from(messageData),
        })
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'GoneException') {
        // 切断済み接続 → レコードをクリーンアップ
        await cleanupStaleConnection(connId);
      }
    }
  })
);
```

### `Promise.allSettled` を使う理由

`Promise.all` だと1つの接続への送信が失敗した時点で全体が中断される。`Promise.allSettled` なら **失敗した接続をスキップして残りの接続には正常に送信** できる。

```
Promise.all:      connA(成功) → connB(失敗) → ❌ 中断（connCに届かない）
Promise.allSettled: connA(成功) → connB(失敗) → connC(成功) ← 全部試行
```

### GoneException — 幽霊接続の掃除

`GoneException` は「そのconnectionIdはもう存在しない」ことを意味する。ブラウザが閉じられたが `$disconnect` が呼ばれなかった場合に発生する。

```typescript
// GoneException発生時のクリーンアップ
async function cleanupStaleConnection(connId: string) {
  // CONNECTION#レコードからuserIdを取得
  const connRecord = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CONNECTION#${connId}`, SK: 'METADATA' },
    })
  );
  const connUserId = connRecord.Item?.userId as string | undefined;

  // 双方向レコードを両方削除
  const deletePromises: Promise<unknown>[] = [
    ddbDocClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: `CONNECTION#${connId}`, SK: 'METADATA' },
      })
    ),
  ];

  if (connUserId) {
    deletePromises.push(
      ddbDocClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${connUserId}`, SK: `CONNECTION#${connId}` },
        })
      )
    );
  }

  await Promise.all(deletePromises);
}
```

**3重の安全策**:

| 対策 | タイミング | 説明 |
|------|----------|------|
| `$disconnect` | 正常切断時 | 接続レコードを即座に削除 |
| GoneExceptionハンドリング | メッセージ送信時 | 幽霊接続を発見次第クリーンアップ |
| TTL（24h） | バックグラウンド | DynamoDBが自動削除。最後の砦 |

## $default — フォールバックハンドラー

```typescript
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('Default route handler called', event);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Default route',
      route: event.requestContext.routeKey,
    }),
  };
};
```

`$default` はルートセレクション式にマッチしないメッセージをキャッチする。本番では「不正なアクション」のログ記録に使える。開発中はデバッグに便利。

## sendMessage内の追加バリデーション

実装では、メッセージ保存の前にいくつかのチェックを行っている:

### 本人確認ステータスのチェック

```typescript
const senderProfile = await ddbDocClient.send(
  new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: `USER#${senderId}`, SK: 'PROFILE' },
  })
);

if (!senderProfile.Item ||
    senderProfile.Item['verificationStatus'] !== 'approved') {
  // WebSocket経由でエラーメッセージを送信者に返す
  await apiGatewayClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify({
        type: 'VERIFICATION_REQUIRED',
        message: '本人確認が必要です。',
      })),
    })
  );
  return { statusCode: 403, body: 'Verification required' };
}
```

WebSocket APIではHTTPレスポンスではなく **WebSocketメッセージとしてエラーを返す**。フロントエンド側でメッセージの `type` を見てエラーハンドリングする。

### チャットルーム参加者の検証

```typescript
const chatRoom = chatRoomQuery.Items?.[0];
const participantIds = chatRoom.participantIds as string[];

if (!participantIds.includes(senderId)) {
  return { statusCode: 403, body: 'Not a participant' };
}
```

REST APIなら認証ミドルウェアで処理するが、WebSocket Lambda では各アクション内で個別にチェックする必要がある。

### メッセージ長のバリデーション

```typescript
if (content.length > 5000) {
  return { statusCode: 400, body: 'Message too long' };
}
```

DynamoDBのアイテムサイズ上限は400KB。メッセージに制限を設けておかないと、巨大なペイロードでコストが膨れ上がる。

## まとめ

| ハンドラー | 責務 | ハマりポイント |
|-----------|------|-------------|
| `connect.ts` | JWT検証 + 双方向レコード保存 | クエリパラメータでトークン受取。ヘッダー不可 |
| `disconnect.ts` | 双方向レコード削除 | 必ず呼ばれるとは限らない。TTLで保険 |
| `sendMessage.ts` | 認証 + 保存 + ブロードキャスト | GoneException処理。Promise.allSettledで全員に配信 |
| `default.ts` | 未知アクションのログ | 開発デバッグ用。本番ではアラート送信も検討 |

WebSocket Lambdaの実装は「ステートフルな接続をステートレスなLambdaで管理する」という矛盾を DynamoDB で橋渡しする設計。接続レコードの整合性（双方向 + TTL + GoneException処理）が肝になる。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> API Gateway WebSocket APIのLambda関数を4つ実装してほしい。TypeScript + AWS SDK v3。
>
> 1. **connect.ts**: `$connect` ルート
>    - クエリパラメータ `?token=xxx` からCognito IDトークンを取得
>    - `aws-jwt-verify` の `CognitoJwtVerifier` で検証
>    - DynamoDBに双方向レコードを保存:
>      - `CONNECTION#{connectionId}` / `METADATA` → userId
>      - `USER#{userId}` / `CONNECTION#{connectionId}` → connectionId
>    - 両方にTTL 24時間を設定
>
> 2. **disconnect.ts**: `$disconnect` ルート
>    - connectionIdからCONNECTIONレコードを取得してuserIdを特定
>    - 双方向レコードを両方削除
>
> 3. **sendMessage.ts**: `sendMessage` ルート
>    - connectionIdから送信者を特定
>    - チャットルームの参加者検証
>    - DynamoDBにメッセージ保存（SK: `MESSAGE#{timestamp}#{messageId}`）
>    - LASTMESSAGEキャッシュ更新
>    - 全参加者の全接続にPromise.allSettledでブロードキャスト
>    - GoneExceptionで切断済み接続の双方向レコードをクリーンアップ
>    - `ApiGatewayManagementApiClient` の endpoint は event.requestContext から動的構築
>
> 4. **default.ts**: `$default` ルート — ログ出力のみ

### エージェントに指示するときの注意点

- `ApiGatewayManagementApiClient` の endpoint をハードコードさせない。必ず `event.requestContext.domainName` + `stage` から構築する
- ブロードキャストは `Promise.all` ではなく `Promise.allSettled` を指定する。理由が分からないと `Promise.all` にされがち
- GoneException時の「双方向レコード両方削除」を忘れやすい。片方だけ削除するとデータの不整合が起きる
- メッセージの `readBy: [senderId]` を初期値として入れないと、送信者自身のメッセージが未読扱いになる

---

次回: [第5回: ReactでリアルタイムチャットUIを作る](/posts/aws-serverless-chat-part5) では、フロントエンドのWebSocketクライアント実装、Zustandでの状態管理、Optimistic UIパターンを解説します。
