---
title: "サーバーレスでリアルタイムチャットを構築する（第2回：接続管理・メッセージ配信編）— Lambda + JWT認証"
emoji: "🔌"
type: "tech"
topics: ["AWS", "Lambda", "WebSocket", "DynamoDB", "Chat"]
published: true
category: "HowTo"
date: "2026-02-28"
description: "WebSocket の $connect/$disconnect Lambda で Cognito JWT 認証と接続管理を実装し、sendMessage でチャットルーム全員にメッセージをブロードキャストする方法を解説します。"
series: "サーバーレスでリアルタイムチャット構築"
seriesOrder: 2
coverImage: "/images/posts/aws-realtime-chat-part2-cover.jpg"
---

> **このシリーズ: 全4回**
> 1. [第1回: インフラ設計編](/posts/aws-realtime-chat-part1)
> 2. [第2回: 接続管理・メッセージ配信編](/posts/aws-realtime-chat-part2) ← 今ここ
> 3. [第3回: チャットルーム・既読管理編](/posts/aws-realtime-chat-part3)
> 4. [第4回: React フロントエンド編](/posts/aws-realtime-chat-part4)

## 概要

[第1回](/posts/aws-realtime-chat-part1)では CDK で API Gateway WebSocket API と DynamoDB のインフラを定義しました。

第2回では、その上で動く **Lambda 関数**を実装します：

- **$connect**: Cognito JWT トークンで認証し、接続情報を DynamoDB に保存
- **$disconnect**: 切断時に接続レコードを削除
- **sendMessage**: メッセージを保存し、チャットルームの全参加者にブロードキャスト
- **ゾンビ接続の自動クリーンアップ**: GoneException の検出と対処

## こんな人向け

- WebSocket APIの `$connect`/`$disconnect` でJWT認証を実装したい
- チャットルーム全員へのメッセージブロードキャストの実装方法を知りたい
- WebSocketのゾンビ接続（GoneException）への対処法を探している

## 前提条件

- 第1回で作成した DynamoDB テーブルと WebSocket API がデプロイ済み
- Amazon Cognito User Pool が設定済み
- `@aws-sdk/client-dynamodb`、`@aws-sdk/lib-dynamodb`、`@aws-sdk/client-apigatewaymanagementapi`、`aws-jwt-verify` がインストール済み

## メッセージ送受信の全体フロー

実装に入る前に、1つのメッセージが送信されてから全員に届くまでの流れを確認します。

```
User A のブラウザ                     AWS                           User B のブラウザ
    │                                │                                │
    │  ① WebSocket接続               │                                │
    │  wss://xxx?token=JWT ────────→ │                                │
    │                    $connect    │                                │
    │                    Lambda      │                                │
    │                      │         │                                │
    │                      ├─ JWT検証 │                                │
    │                      ├─ DynamoDB に接続保存                     │
    │                      │         │                                │
    │  ② メッセージ送信              │                                │
    │  {action:"sendMessage",        │                                │
    │   chatRoomId, content} ──────→ │                                │
    │                  sendMessage   │                                │
    │                  Lambda        │                                │
    │                    │           │                                │
    │                    ├─ 接続IDからユーザー特定                    │
    │                    ├─ 本人確認チェック                          │
    │                    ├─ ルーム参加者チェック                      │
    │                    ├─ メッセージをDynamoDB保存                  │
    │                    ├─ 参加者の全接続を取得                      │
    │                    │           │                                │
    │  ③ ブロードキャスト            │                                │
    │  ←──── PostToConnection ───────┤──── PostToConnection ────────→ │
    │  {type:"message", data:{...}}  │  {type:"message", data:{...}} │
```

## $connect: JWT 認証と接続保存

WebSocket API では、HTTP ヘッダーに `Authorization` を設定できません。代わりに **クエリパラメータ** でトークンを渡します。

```
wss://xxx.execute-api.ap-northeast-1.amazonaws.com/dev?token=eyJraWQ...
```

### 実装

```typescript
// backend/functions/websocket/connect.ts
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.CLIENT_ID!,
});

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // クエリパラメータからトークンを取得
  const queryParams = (event as Record<string, unknown>).queryStringParameters
    as Record<string, string> | undefined;
  const token = queryParams?.token;

  if (!token) {
    return { statusCode: 401, body: 'No token provided' };
  }

  // Cognito JWT を検証
  let userId: string;
  try {
    const payload = await verifier.verify(token);
    userId = payload.sub;
  } catch {
    return { statusCode: 401, body: 'Invalid token' };
  }

  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24時間後

  // DynamoDB に2レコード書き込み
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
        ttl,
      },
    })
  );

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${userId}`,
        SK: `CONNECTION#${connectionId}`,
        Type: 'UserConnection',
        connectionId,
        connectedAt: now,
        ttl,
      },
    })
  );

  return { statusCode: 200, body: 'Connected' };
};
```

### なぜ2レコード書くのか

接続情報を**双方向に引ける**ようにするためです：

```
用途①: connectionId → userId を引く（メッセージ送信時に送信者を特定）
  PK: CONNECTION#abc-123    SK: METADATA
  → userId: user-A

用途②: userId → 全 connectionId を引く（ブロードキャスト時に宛先を取得）
  PK: USER#user-A    SK: CONNECTION#abc-123
  PK: USER#user-A    SK: CONNECTION#def-456  ← 複数タブ/デバイス対応
```

1ユーザーが複数タブでチャットを開いている場合、接続は複数になります。用途②のパターンで `begins_with(SK, 'CONNECTION#')` とクエリすれば、そのユーザーの全接続を一度に取得できます。

### TTL の設定

```typescript
ttl: Math.floor(Date.now() / 1000) + 86400  // 24時間後（Unix秒）
```

DynamoDB の TTL は **Unix秒** で指定します（ミリ秒ではありません）。ネットワーク断で `$disconnect` が呼ばれずにレコードが残っても、24時間後に DynamoDB が自動削除します。

## $disconnect: 接続レコードの削除

切断時は、$connect で作成した2レコードを両方削除します。

```typescript
// backend/functions/websocket/disconnect.ts
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, DeleteCommand, QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // connectionId から userId を取得
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `CONNECTION#${connectionId}`,
      },
    })
  );

  const connection = result.Items?.[0];
  if (!connection) {
    // 既に削除済み（TTL等）→ 正常終了
    return { statusCode: 200, body: 'OK' };
  }

  const userId = connection.userId;

  // 2レコードを削除
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

ポイント：接続レコードが見つからない場合はエラーにせず正常終了します。TTL で既に削除されている、または別の処理（ゾンビ接続クリーンアップ）で先に消されている可能性があるためです。

## sendMessage: メッセージ保存とブロードキャスト

sendMessage はこのシステムの中核です。処理ステップが多いため、順に解説します。

### 全体の処理フロー

```
sendMessage Lambda
  │
  ├─ 1. リクエスト解析（chatRoomId, content）
  ├─ 2. connectionId → userId 特定
  ├─ 3. ユーザーの本人確認ステータス検証
  ├─ 4. チャットルーム存在確認 & 参加者チェック
  ├─ 5. メッセージ長バリデーション（最大 5000文字）
  ├─ 6. メッセージを DynamoDB に保存
  ├─ 7. LASTMESSAGE レコードを更新
  ├─ 8. 全参加者のアクティブ接続を取得
  └─ 9. PostToConnectionCommand で一斉送信
```

### 実装

```typescript
// backend/functions/websocket/sendMessage.ts
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand, QueryCommand, GetCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { randomUUID } from 'crypto';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const { domainName, stage } = event.requestContext;

  const apiGwClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  const body = JSON.parse(event.body || '{}');
  const { chatRoomId, content } = body;

  // --- 1. バリデーション ---
  if (!chatRoomId || !content) {
    return { statusCode: 400, body: 'chatRoomId and content are required' };
  }
  if (content.length > 5000) {
    return { statusCode: 400, body: 'Message too long (max 5000)' };
  }

  // --- 2. 送信者を特定 ---
  const connResult = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `CONNECTION#${connectionId}` },
    })
  );
  const senderId = connResult.Items?.[0]?.userId;
  if (!senderId) {
    return { statusCode: 401, body: 'Connection not found' };
  }

  // --- 3. 本人確認チェック ---
  const profileResult = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${senderId}`, SK: 'PROFILE' },
    })
  );
  if (profileResult.Item?.verificationStatus !== 'approved') {
    // WebSocket 経由でエラーを返す
    await apiGwClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify({
          type: 'VERIFICATION_REQUIRED',
          message: '本人確認が必要です',
        })),
      })
    );
    return { statusCode: 403, body: 'Verification required' };
  }

  // --- 4. チャットルーム参加者チェック ---
  const roomResult = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `CHATROOM#${chatRoomId}`,
        ':sk': 'METADATA',
      },
    })
  );
  const participantIds = roomResult.Items?.[0]?.participantIds as string[];
  if (!participantIds?.includes(senderId)) {
    return { statusCode: 403, body: 'Not a participant' };
  }

  // --- 5. メッセージを保存 ---
  const messageId = randomUUID();
  const timestamp = Date.now();
  const now = new Date().toISOString();

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CHATROOM#${chatRoomId}`,
        SK: `MESSAGE#${timestamp}#${messageId}`,
        Type: 'Message',
        messageId,
        chatRoomId,
        senderId,
        content,
        messageType: 'user',
        readBy: [senderId],
        createdAt: now,
        timestamp,
      },
    })
  );

  // --- 6. LASTMESSAGE を更新 ---
  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CHATROOM#${chatRoomId}`,
        SK: 'LASTMESSAGE',
        lastMessageAt: now,
        lastMessage: content.substring(0, 100),
      },
    })
  );

  // --- 7. 全参加者の接続を収集 ---
  const connections: string[] = [];
  for (const pid of participantIds) {
    const conns = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${pid}`,
          ':sk': 'CONNECTION#',
        },
      })
    );
    if (conns.Items) {
      connections.push(...conns.Items.map((item) => item.connectionId));
    }
  }

  // --- 8. ブロードキャスト ---
  const messageData = JSON.stringify({
    type: 'message',
    data: {
      messageId, chatRoomId, senderId,
      content, messageType: 'user',
      createdAt: now, timestamp,
    },
  });

  await Promise.allSettled(
    connections.map(async (connId) => {
      try {
        await apiGwClient.send(
          new PostToConnectionCommand({
            ConnectionId: connId,
            Data: Buffer.from(messageData),
          })
        );
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'GoneException') {
          await cleanupStaleConnection(connId);
        }
      }
    })
  );

  return { statusCode: 200, body: JSON.stringify({ messageId }) };
};
```

### readBy: 送信者は自動的に「既読」

```typescript
readBy: [senderId],  // 送信者は自分のメッセージを読んでいる
```

メッセージ保存時に `readBy` 配列を初期化します。受信者が既読にする処理は第3回で解説します。

### LASTMESSAGE レコード

```typescript
{
  PK: `CHATROOM#${chatRoomId}`,
  SK: 'LASTMESSAGE',
  lastMessageAt: now,
  lastMessage: content.substring(0, 100),  // 先頭100文字
}
```

チャットルーム一覧で「最後のメッセージ」を表示するためのレコードです。ルーム一覧を取得するたびに全メッセージを走査するのは非効率なため、最新メッセージのプレビューを専用レコードに保持します。

## ブロードキャスト: PostToConnectionCommand

API Gateway WebSocket API の核心的な機能が `PostToConnectionCommand` です。**サーバー側から任意の WebSocket 接続にデータを送信** できます。

```typescript
const apiGwClient = new ApiGatewayManagementApiClient({
  endpoint: `https://${domainName}/${stage}`,
});

await apiGwClient.send(
  new PostToConnectionCommand({
    ConnectionId: connId,        // 送信先の接続ID
    Data: Buffer.from(payload),  // 送信データ（Buffer）
  })
);
```

### endpoint の構築

`PostToConnectionCommand` のエンドポイントは WebSocket API の URL ではなく、**Management API の URL** です：

```
WebSocket 接続先: wss://abc123.execute-api.ap-northeast-1.amazonaws.com/dev
Management API:   https://abc123.execute-api.ap-northeast-1.amazonaws.com/dev
```

`event.requestContext` の `domainName` と `stage` から構築できます。

### Promise.allSettled を使う理由

```typescript
// ✅ allSettled: 1つが失敗しても他は続行
await Promise.allSettled(connections.map(...));

// ❌ all: 1つが失敗すると全体が中断
await Promise.all(connections.map(...));
```

5人のチャットルームで1人の接続が切れていたら？ `Promise.all` だとその1人のエラーで残り4人への配信も中断されます。`Promise.allSettled` なら、失敗した接続は無視して残りに正常に配信できます。

## ゾンビ接続のクリーンアップ

WebSocket 接続はネットワーク断、ブラウザクラッシュ、タブを閉じたとき等に `$disconnect` が呼ばれない場合があります。これが**ゾンビ接続**です。

### 検出のタイミング

ゾンビ接続に `PostToConnectionCommand` を送ると、API Gateway が `GoneException`（HTTP 410）を返します。これをキャッチしてレコードを削除します：

```typescript
try {
  await apiGwClient.send(
    new PostToConnectionCommand({
      ConnectionId: connId,
      Data: Buffer.from(messageData),
    })
  );
} catch (error: unknown) {
  if (error instanceof Error && error.name === 'GoneException') {
    // この接続はもう存在しない → レコードを削除
    const connRecord = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `CONNECTION#${connId}`, SK: 'METADATA' },
      })
    );
    const connUserId = connRecord.Item?.userId;

    const deletes = [
      ddbDocClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `CONNECTION#${connId}`, SK: 'METADATA' },
        })
      ),
    ];
    if (connUserId) {
      deletes.push(
        ddbDocClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${connUserId}`, SK: `CONNECTION#${connId}` },
          })
        )
      );
    }
    await Promise.all(deletes);
  }
}
```

### 3段構えの防御

ゾンビ接続は1つの仕組みだけでは完全に防げません。本実装では3段構えで対処しています：

```
第1段: $disconnect Lambda
  → 正常な切断時に即座にレコード削除

第2段: GoneException キャッチ
  → ブロードキャスト時にゾンビを検出して削除

第3段: DynamoDB TTL (24時間)
  → 上記2つをすり抜けたレコードも自動削除
```

## broadcastToRoom: 再利用可能なユーティリティ

sendMessage 以外にも「チャットルーム全員に通知する」場面があります（参加者追加時のシステムメッセージ等）。ブロードキャスト処理を共通関数に切り出します：

```typescript
// backend/functions/common/broadcastToRoom.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, QueryCommand, GetCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface BroadcastMessage {
  type: string;
  data: Record<string, string | number | boolean | null>;
}

export const broadcastToRoom = async (
  tableName: string,
  wsEndpoint: string,
  chatRoomId: string,
  message: BroadcastMessage
): Promise<void> => {
  // ルームの参加者一覧を取得
  const roomResult = await ddbDocClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `CHATROOM#${chatRoomId}`, SK: 'METADATA' },
    })
  );
  if (!roomResult.Item) return;

  const participantIds = roomResult.Item.participantIds as string[];
  const apiGwClient = new ApiGatewayManagementApiClient({
    endpoint: wsEndpoint,
  });

  // 全参加者の接続IDを収集
  const connections: string[] = [];
  for (const pid of participantIds) {
    const conns = await ddbDocClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${pid}`,
          ':sk': 'CONNECTION#',
        },
      })
    );
    if (conns.Items) {
      connections.push(...conns.Items.map((item) => item.connectionId as string));
    }
  }

  // 一斉送信（ゾンビ接続は検出して削除）
  const payload = JSON.stringify(message);
  await Promise.allSettled(
    connections.map(async (connId) => {
      try {
        await apiGwClient.send(
          new PostToConnectionCommand({
            ConnectionId: connId,
            Data: Buffer.from(payload),
          })
        );
      } catch (error: unknown) {
        if (
          error && typeof error === 'object' &&
          'statusCode' in error &&
          (error as { statusCode: number }).statusCode === 410
        ) {
          await ddbDocClient.send(
            new DeleteCommand({
              TableName: tableName,
              Key: { PK: `CONNECTION#${connId}`, SK: 'METADATA' },
            })
          );
        }
      }
    })
  );
};
```

第3回で実装するアクティビティ参加時のシステムメッセージ送信で、この関数を使います：

```typescript
await broadcastToRoom(TABLE_NAME, wsEndpoint, chatRoomId, {
  type: 'system',
  data: { content: `${nickname}さんが参加しました`, messageType: 'system' },
});
```

## ポイント・注意点

### WebSocket API の認証はクエリパラメータ

HTTP の WebSocket ハンドシェイクでは `Authorization` ヘッダーを設定できない（ブラウザの WebSocket API の制約）ため、トークンをクエリパラメータで渡します。HTTPS 通信なのでトークンの盗聴リスクは低いですが、サーバーのアクセスログにトークンが残る可能性がある点は認識しておく必要があります。

### Lambda のコールドスタート

WebSocket の `$connect` ルートは接続確立のタイミングで呼ばれるため、Lambda のコールドスタートが接続遅延に直結します。対策としては：

- **Provisioned Concurrency** で Lambda をウォーム状態に保つ
- Lambda 関数のバンドルサイズを小さくする（不要な依存を除く）
- `DynamoDBClient` や `CognitoJwtVerifier` をハンドラー外で初期化（ウォームスタート時に再利用）

### メッセージ順序の保証

DynamoDB のソートキー `MESSAGE#{timestamp}#{messageId}` はクライアントのミリ秒タイムスタンプに依存しています。厳密な順序保証が必要な場合は、Lambda 側で `Date.now()` を使うことで **サーバー時刻** ベースの一貫性が得られます（本実装はこのアプローチを採用）。

## まとめ

第2回では、WebSocket の接続管理とメッセージ配信の Lambda を実装しました：

- **$connect** は JWT をクエリパラメータで受け取り、Cognito Verifier で検証後、双方向の接続レコードを保存
- **$disconnect** は接続レコードを2つとも削除。レコードが見つからなくてもエラーにしない
- **sendMessage** は本人確認・参加者チェック後にメッセージを保存し、`PostToConnectionCommand` で全参加者にブロードキャスト
- **ゾンビ接続** は GoneException 検出 + TTL の3段構えで対処
- **broadcastToRoom** として共通化し、システムメッセージ等にも再利用可能に

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> API Gateway WebSocket API の Lambda ハンドラーを TypeScript で実装してください。
>
> 技術スタック：
> - Node.js 20.x Lambda、TypeScript
> - @aws-sdk/client-dynamodb、@aws-sdk/lib-dynamodb
> - @aws-sdk/client-apigatewaymanagementapi
> - aws-jwt-verify（Cognito JWT 検証）
>
> $connect ハンドラー：
> - クエリパラメータ `token` から Cognito ID トークンを取得し、CognitoJwtVerifier で検証
> - DynamoDB に 2 レコード書き込み: CONNECTION#{connId}#METADATA と USER#{userId}#CONNECTION#{connId}
> - 両レコードに ttl（Unix秒、24時間後）を設定
>
> $disconnect ハンドラー：
> - CONNECTION#{connId} から userId を Query で取得
> - 2 レコードを DeleteCommand で削除。レコードが見つからない場合はエラーにしない
>
> sendMessage ハンドラー：
> - event.body から chatRoomId と content を取得
> - connectionId → userId を Connection レコードから特定
> - ユーザーの PROFILE レコードで verificationStatus === 'approved' を確認（未承認なら VERIFICATION_REQUIRED をWebSocket経由で返す）
> - CHATROOM#{roomId}#METADATA の participantIds に senderId が含まれるか確認
> - content は最大 5000 文字
> - メッセージを PK=CHATROOM#{roomId} SK=MESSAGE#{timestamp}#{messageId} で保存。readBy: [senderId] を初期値に
> - LASTMESSAGE レコード（lastMessageAt, lastMessage の先頭100文字）を PutCommand で更新
> - 全参加者の接続を USER#{pid} SK begins_with CONNECTION# で収集
> - PostToConnectionCommand で一斉送信。Promise.allSettled を使用
> - GoneException をキャッチしたら CONNECTION と UserConnection の両レコードを削除

---

次回: [第3回: チャットルーム・既読管理編](/posts/aws-realtime-chat-part3) では、チャットルームの作成・参加者管理と、既読・未読の実装を解説します。
