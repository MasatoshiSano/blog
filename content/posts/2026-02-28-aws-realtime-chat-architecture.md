---
title: "API Gateway WebSocket + Lambda + DynamoDB でリアルタイムチャットを構築する"
emoji: "💬"
type: "tech"
topics: ["AWS", "WebSocket", "Lambda", "DynamoDB", "CDK", "Chat"]
published: true
category: "Architecture"
date: "2026-02-28"
description: "API Gateway WebSocketを使ったサーバーレスなリアルタイムチャットの全体設計。接続管理、メッセージ配信、認証、フロントエンド連携までを実装コード付きで解説する。"
---

## 概要

複数人がリアルタイムにメッセージをやりとりするチャット機能を、AWSのサーバーレスサービスだけで構築した。WebSocket専用サーバーを運用せずに、API Gateway WebSocket + Lambda + DynamoDB の組み合わせで本番運用可能なチャットを実現する方法を解説する。

この記事で得られるもの：
- API Gateway WebSocket APIのルーティング設計
- Lambda関数による接続ライフサイクル管理
- DynamoDB単一テーブルでのコネクション・メッセージ永続化
- Cognito JWTによるWebSocket認証
- フロントエンドからの接続とメッセージ送受信

## 前提条件

- AWS CDK v2（TypeScript）
- Node.js 20.x（Lambda Runtime）
- DynamoDB テーブル（Single-Table Design）
- Amazon Cognito User Pool（認証）
- React + Zustand（フロントエンド）

## 全体アーキテクチャ

```
┌─────────────┐     wss://     ┌──────────────────────┐
│  React App  │ ◄────────────► │  API Gateway WebSocket│
│  (Browser)  │                │                      │
└─────────────┘                └──────┬───────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                  │
              ┌─────▼─────┐   ┌──────▼──────┐   ┌──────▼──────┐
              │ $connect   │   │ sendMessage │   │ $disconnect │
              │  Lambda    │   │  Lambda     │   │  Lambda     │
              └─────┬─────┘   └──────┬──────┘   └──────┬──────┘
                    │                │                  │
                    └────────────────┼──────────────────┘
                                     │
                              ┌──────▼──────┐
                              │  DynamoDB   │
                              │ (単一テーブル) │
                              └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │  Cognito    │
                              │ (JWT検証)   │
                              └─────────────┘
```

メッセージの流れ：

1. クライアントが `wss://` でWebSocket接続（JWTトークン付き）
2. `$connect` Lambdaがトークンを検証し、接続情報をDynamoDBに保存
3. クライアントが `sendMessage` アクションでメッセージ送信
4. `sendMessage` Lambdaがメッセージを永続化し、全参加者のコネクションに配信
5. 切断時に `$disconnect` Lambdaが接続レコードを削除

## CDKによるインフラ定義

WebSocket APIのCDK定義。ポイントは `routeSelectionExpression` でクライアントからのJSONの `action` フィールドによってルーティングする点。

```typescript
// WebSocket API Gateway
const webSocketApi = new apigatewayv2.CfnApi(this, 'WebSocketApi', {
  name: `MyApp-WebSocket-${props.envName}`,
  protocolType: 'WEBSOCKET',
  routeSelectionExpression: '$request.body.action',
});
```

Lambda関数には DynamoDB への読み書き権限と、API Gateway のコネクション管理権限（`execute-api:ManageConnections`）を付与する。後者がないと、サーバーからクライアントへのメッセージ送信（Push）ができない。

```typescript
// メッセージ配信に必要な権限
lambdaRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ['execute-api:ManageConnections'],
    resources: [
      `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*`,
    ],
  })
);
```

ルートは4つ定義する：

| ルートキー | 用途 |
|-----------|------|
| `$connect` | WebSocket接続時。JWT認証を行う |
| `$disconnect` | 切断時。接続レコードをクリーンアップ |
| `sendMessage` | メッセージ送信。永続化＋全参加者へ配信 |
| `$default` | 未知のアクション。200を返すだけ |

## 接続ハンドラ（$connect）

WebSocket接続時にCognito JWTトークンを検証し、接続情報をDynamoDBに保存する。

```typescript
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',
  clientId: CLIENT_ID,
});

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = queryStringParameters?.token;

  // JWT検証
  const payload = await verifier.verify(token);
  const userId = payload.sub;

  // 接続レコードを保存（2つのレコード）
  // 1. CONNECTION#{connectionId} → METADATA（接続→ユーザーの逆引き）
  await ddbDocClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CONNECTION#${connectionId}`,
      SK: 'METADATA',
      connectionId, userId,
      ttl: Math.floor(Date.now() / 1000) + 86400, // 24時間TTL
    },
  }));

  // 2. USER#{userId} → CONNECTION#{connectionId}（ユーザー→接続の正引き）
  await ddbDocClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `USER#${userId}`,
      SK: `CONNECTION#${connectionId}`,
      connectionId,
      ttl: Math.floor(Date.now() / 1000) + 86400,
    },
  }));

  return { statusCode: 200, body: 'Connected' };
};
```

**設計のポイント:**

- **双方向マッピング**: `CONNECTION#→USER#`（接続IDからユーザー特定）と `USER#→CONNECTION#`（ユーザーの全接続取得）の両方を保存する。sendMessage時にユーザーの全接続を取得する必要があるため
- **TTL**: 24時間のTTLを設定。切断イベントが漏れた場合のセーフティネット
- **トークン渡し方法**: WebSocketの `$connect` ではHTTPヘッダーのカスタマイズが制限されるため、クエリパラメータ `?token=xxx` でJWTを渡す

## メッセージ送信ハンドラ（sendMessage）

チャットの核心部分。メッセージの検証→永続化→全参加者への配信を行う。

```typescript
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const { chatRoomId, content } = JSON.parse(event.body || '{}');

  // 1. 接続情報から送信者を特定
  const connection = await getConnectionMetadata(connectionId);
  const senderId = connection.userId;

  // 2. 送信者の本人確認ステータスを検証
  const senderProfile = await getUserProfile(senderId);
  if (senderProfile.verificationStatus !== 'approved') {
    // 未確認ユーザーにはWebSocket経由でエラーを返す
    await postToConnection(connectionId, {
      type: 'VERIFICATION_REQUIRED',
      message: '本人確認が必要です',
    });
    return { statusCode: 403, body: 'Verification required' };
  }

  // 3. チャットルーム参加者の検証
  const chatRoom = await getChatRoomMetadata(chatRoomId);
  if (!chatRoom.participantIds.includes(senderId)) {
    return { statusCode: 403, body: 'Not a participant' };
  }

  // 4. メッセージ永続化
  const messageId = randomUUID();
  const timestamp = Date.now();
  await ddbDocClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CHATROOM#${chatRoomId}`,
      SK: `MESSAGE#${timestamp}#${messageId}`,
      messageId, chatRoomId, senderId, content,
      messageType: 'user',
      createdAt: new Date().toISOString(),
      timestamp,
    },
  }));

  // 5. 最終メッセージ情報を更新（ルーム一覧のソート用）
  await ddbDocClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CHATROOM#${chatRoomId}`,
      SK: 'LASTMESSAGE',
      lastMessageAt: new Date().toISOString(),
      lastMessage: content.substring(0, 100),
    },
  }));

  // 6. 全参加者のコネクションを取得してブロードキャスト
  const connections: string[] = [];
  for (const participantId of chatRoom.participantIds) {
    const userConnections = await ddbDocClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${participantId}`,
        ':sk': 'CONNECTION#',
      },
    }));
    connections.push(...userConnections.Items.map(item => item.connectionId));
  }

  // 7. Promise.allSettledで並列配信（1つ失敗しても他は継続）
  await Promise.allSettled(
    connections.map(connId => postToConnection(connId, messageData))
  );

  return { statusCode: 200, body: JSON.stringify({ messageId }) };
};
```

**設計のポイント:**

- **`Promise.allSettled`**: 1つのコネクションへの送信が失敗しても、他の参加者への配信は止まらない
- **GoneException処理**: 切断済みのコネクションに送信すると `GoneException` が発生する。このとき接続レコードを自動削除して「ゾンビ接続」を掃除する
- **LASTMESSAGE レコード**: メッセージ全体をスキャンせずに、ルーム一覧で「最後のメッセージ」を高速表示するための非正規化

## 切断ハンドラ（$disconnect）

接続レコードの双方向マッピングを両方削除する。

```typescript
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // 接続情報からuserIdを取得
  const connection = await getConnectionMetadata(connectionId);
  const userId = connection.userId;

  // 双方向のレコードを削除
  await ddbDocClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: `CONNECTION#${connectionId}`, SK: 'METADATA' },
  }));

  await ddbDocClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: `USER#${userId}`, SK: `CONNECTION#${connectionId}` },
  }));

  return { statusCode: 200, body: 'Disconnected' };
};
```

## フロントエンド実装

### WebSocketサービス

```typescript
export class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;

  connect(): Promise<void> {
    // ゾンビ接続を防ぐ: 既存の接続を閉じてから新規接続
    if (this.ws) {
      this.ws.onclose = null; // 再接続トリガーを無効化
      this.ws.close();
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      const token = this.getAccessToken();
      this.ws = new WebSocket(`${this.url}?token=${token}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat(); // 30秒間隔のping
        resolve();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.messageHandlers.forEach(handler => handler(message));
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (!this.intentionalClose) {
          this.attemptReconnect(); // 指数バックオフで再接続
        }
      };
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    // 1s → 2s → 4s → 8s → 16s
    setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'ping' }));
      }
    }, 30000);
  }
}
```

### メッセージの重複排除（Zustandストア）

楽観的更新とWebSocketブロードキャストの両方でメッセージが来るため、重複排除ロジックが必要。

```typescript
addMessage: (message) =>
  set((state) => {
    const isDuplicate = state.messages.some(
      (m) =>
        m.messageId === message.messageId ||
        (m.senderId === message.senderId &&
          m.content === message.content &&
          Math.abs(m.timestamp - message.timestamp) < 5000)
    );
    if (isDuplicate) return state;
    return { messages: [...state.messages, message] };
  }),
```

**2段階の重複チェック:**
1. `messageId` の完全一致
2. 同一送信者 + 同一内容 + 5秒以内 → 楽観的に追加したメッセージとブロードキャストの重複を防ぐ

## ポイント・注意点

### API Gateway WebSocketの制約

- **接続タイムアウト**: アイドル状態が10分続くと切断される → ハートビート（30秒間隔のping）で回避
- **ペイロードサイズ**: 最大128KB → メッセージ長を5000文字に制限
- **同時接続数**: デフォルトで500。スロットリング設定でバースト500、レート1000に設定

### DynamoDBのTTLによるクリーンアップ

接続レコードに24時間のTTLを設定することで、`$disconnect` イベントが漏れた場合でも自動的にレコードが削除される。TTLはDynamoDB側で非同期に処理されるため、即座には消えないが、数時間以内にはクリーンアップされる。

### GoneExceptionの扱い

メッセージ配信時に切断済みのコネクションIDに送信すると `GoneException` が発生する。これをキャッチして接続レコードを削除することで、次回の配信時に無駄なリクエストを減らす。

```typescript
catch (error) {
  if (error instanceof Error && error.name === 'GoneException') {
    // 双方向レコードを削除
    await deleteConnectionRecords(connId);
  }
}
```

## まとめ

- **API Gateway WebSocket**: WebSocket専用サーバーなしでリアルタイム通信を実現
- **Lambda**: ステートレスなイベントハンドラで接続管理とメッセージ配信を処理
- **DynamoDB Single-Table**: 接続マッピング、チャットルーム、メッセージを1テーブルで管理
- **Cognito**: `$connect` 時にJWTを検証し、認証済みユーザーのみ接続を許可
- **フロントエンド**: 指数バックオフ再接続、ハートビート、メッセージ重複排除で堅牢な接続管理

サーバーレスなので、接続数ゼロのときはコストもゼロ。スケーリングもAWS側が自動で処理する。チャット機能を最小構成で始めたいプロジェクトに適したアーキテクチャだ。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> AWS CDK v2（TypeScript）で、API Gateway WebSocket + Lambda + DynamoDB を使ったリアルタイムチャット機能を実装してください。
>
> 要件:
> - API Gateway WebSocket APIを作成し、`$request.body.action` でルーティングする
> - ルートは `$connect`, `$disconnect`, `sendMessage`, `$default` の4つ
> - `$connect` ではクエリパラメータ `?token=xxx` でCognito IDトークンを受け取り、`aws-jwt-verify` で検証する
> - 接続情報はDynamoDBに双方向マッピングで保存: `CONNECTION#{connectionId}→METADATA` と `USER#{userId}→CONNECTION#{connectionId}`
> - 接続レコードには24時間のTTLを設定する
> - `sendMessage` ではメッセージをDynamoDBに永続化後、チャットルームの全参加者のコネクションに `ApiGatewayManagementApiClient` の `PostToConnectionCommand` でブロードキャストする
> - ブロードキャストは `Promise.allSettled` で並列実行し、`GoneException` 発生時はゾンビ接続レコードを削除する
> - Lambda関数には DynamoDB ReadWrite と `execute-api:ManageConnections` の権限を付与する
> - フロントエンドのWebSocketサービスでは、指数バックオフ再接続（最大5回）と30秒間隔のハートビートを実装する
> - メッセージの重複排除は messageId の一致 または 同一送信者+同一内容+5秒以内 で判定する
>
> 注意点:
> - API Gateway WebSocketのアイドルタイムアウトは10分なので、ハートビートで接続を維持する
> - DynamoDB Single-Table Design を採用し、PK/SKパターンで接続・ユーザー・チャットルーム・メッセージを管理する
> - メッセージのSKは `MESSAGE#{timestamp}#{messageId}` で時系列ソートを保証する
