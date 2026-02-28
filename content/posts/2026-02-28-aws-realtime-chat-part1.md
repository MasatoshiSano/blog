---
title: "API Gateway WebSocket + DynamoDB でリアルタイムチャットを作る（第1回：インフラ設計編）"
emoji: "⚡"
type: "tech"
topics: ["AWS", "CDK", "WebSocket", "DynamoDB", "Chat"]
published: true
category: "HowTo"
date: "2026-02-28"
description: "AWS CDKでAPI Gateway WebSocket APIとDynamoDB Single Table Designを使ったリアルタイムチャットのインフラ設計を解説。接続管理・メッセージ・チャットルームを1テーブルで扱うキー設計パターンを紹介します。"
series: "AWS リアルタイムチャット構築"
seriesOrder: 1
coverImage: "/images/posts/aws-realtime-chat-part1-cover.jpg"
---

> **このシリーズ: 全4回**
> 1. [第1回: インフラ設計編](/posts/aws-realtime-chat-part1) ← 今ここ
> 2. [第2回: 接続管理・メッセージ配信編](/posts/aws-realtime-chat-part2)
> 3. [第3回: チャットルーム・既読管理編](/posts/aws-realtime-chat-part3)
> 4. [第4回: React フロントエンド編](/posts/aws-realtime-chat-part4)

## 概要

「複数人がリアルタイムにチャットできる機能」を AWS 上に構築する方法を、全4回に分けて解説します。

第1回ではインフラの土台を作ります。具体的には：

- **API Gateway WebSocket API** の仕組みと CDK による定義
- **DynamoDB Single Table Design** で接続・メッセージ・チャットルーム・既読状態を1テーブルに収めるキー設計
- **CDK スタック構成** とデプロイ順序の設計

完成形のアーキテクチャは以下のとおりです。

```
┌──────────────┐     wss://       ┌─────────────────────────┐
│  React App   │ ───────────────→ │  API Gateway WebSocket  │
│  (Frontend)  │ ←─────────────── │  ($connect / $disconnect│
└──────────────┘                  │   / sendMessage)        │
                                  └───────┬─────────────────┘
                                          │ AWS_PROXY
                                  ┌───────▼─────────────────┐
                                  │   Lambda Functions       │
                                  │  ┌─────────────────┐    │
                                  │  │ connect.ts       │    │
                                  │  │ disconnect.ts    │    │
                                  │  │ sendMessage.ts   │    │
                                  │  └─────────────────┘    │
                                  └───────┬─────────────────┘
                                          │
                              ┌───────────▼──────────────┐
                              │   DynamoDB (Single Table) │
                              │                          │
                              │  CONNECTION#xxx METADATA  │
                              │  USER#xxx CONNECTION#xxx  │
                              │  CHATROOM#xxx METADATA    │
                              │  CHATROOM#xxx MESSAGE#xxx │
                              └──────────────────────────┘
```

## 前提条件

- Node.js 20.x 以上
- AWS CDK v2 がインストール済み
- AWS アカウントに `cdk bootstrap` 済み
- TypeScript の基本知識

## API Gateway WebSocket API とは

REST API が「リクエスト → レスポンス」の1往復で完結するのに対し、WebSocket API は **クライアントとサーバー間の接続を維持** し続けます。

```
REST API:
  Client ──GET /messages──→ Server ──200 OK──→ Client
  (毎回接続→切断)

WebSocket API:
  Client ──$connect──→ Server    (接続確立)
  Client ←──message───  Server    (サーバーからプッシュ)
  Client ──message──→  Server    (クライアントから送信)
  Client ←──message───  Server    (別ユーザーのメッセージ転送)
  Client ──$disconnect→ Server    (切断)
```

API Gateway WebSocket API は、この永続接続をマネージドで提供します。重要なポイント：

- **ルート選択式**: `$request.body.action` でメッセージ本文の `action` フィールドを見て、適切な Lambda にルーティング
- **3つの特殊ルート**: `$connect`（接続時）、`$disconnect`（切断時）、`$default`（未定義のアクション）
- **接続管理 API**: `PostToConnectionCommand` でサーバー側から任意の接続にメッセージをプッシュできる

## DynamoDB Single Table Design

### なぜ Single Table Design か

チャットシステムで扱うエンティティは以下の5種類です：

| エンティティ | 説明 |
|-------------|------|
| **Connection** | WebSocket の接続情報（connectionId ↔ userId） |
| **UserConnection** | ユーザーが持つアクティブな接続の一覧 |
| **ChatRoom** | チャットルームのメタデータ（参加者、タイプ等） |
| **Message** | チャットメッセージ本文 |
| **ChatParticipation** | ユーザーがどのルームに参加しているか |

これらを別々のテーブルに分けると、テーブル間の JOIN ができない DynamoDB では複数回のクエリが必要になります。Single Table Design なら、**1回の Query で関連データをまとめて取得** できます。

### キー設計一覧

```
┌──────────────────────┬──────────────────────────────┬──────────────┐
│ PK                   │ SK                           │ 用途         │
├──────────────────────┼──────────────────────────────┼──────────────┤
│ CONNECTION#{connId}  │ METADATA                     │ 接続情報     │
│ USER#{userId}        │ CONNECTION#{connId}           │ ユーザーの   │
│                      │                              │ 接続一覧     │
│ CHATROOM#{roomId}    │ METADATA                     │ ルーム情報   │
│ CHATROOM#{roomId}    │ MESSAGE#{timestamp}#{msgId}   │ メッセージ   │
│ CHATROOM#{roomId}    │ LASTMESSAGE                  │ 最新メッセージ│
│ USER#{userId}        │ CHATROOM#{roomId}             │ 参加ルーム   │
└──────────────────────┴──────────────────────────────┴──────────────┘
```

### アクセスパターンとキー設計の対応

それぞれのアクセスパターンが、どのキーで実現できるか整理します：

| アクセスパターン | クエリ方法 |
|-----------------|-----------|
| 接続IDからユーザーを特定 | `PK = CONNECTION#{connId}` |
| ユーザーの全接続を取得 | `PK = USER#{userId}, SK begins_with CONNECTION#` |
| ルームのメッセージ一覧 | `PK = CHATROOM#{roomId}, SK begins_with MESSAGE#` |
| ルームの最新メッセージ | `PK = CHATROOM#{roomId}, SK = LASTMESSAGE` |
| ユーザーの参加ルーム一覧 | `PK = USER#{userId}, SK begins_with CHATROOM#` |

### メッセージの SK 設計

メッセージのソートキーは `MESSAGE#{timestamp}#{messageId}` です。

```
MESSAGE#1709136000000#a1b2c3d4
MESSAGE#1709136001234#e5f6g7h8
MESSAGE#1709136002000#i9j0k1l2
```

- **timestamp が先**: `ScanIndexForward: false` で新しいメッセージから取得。ページネーションにも対応
- **messageId を末尾に追加**: 同一ミリ秒に複数メッセージが来ても一意性を保証

### 既読管理の設計

各メッセージに `readBy` 配列を持たせます：

```json
{
  "PK": "CHATROOM#room-123",
  "SK": "MESSAGE#1709136000000#msg-456",
  "senderId": "user-A",
  "content": "こんにちは",
  "readBy": ["user-A", "user-B"]
}
```

- メッセージ送信時、`readBy` に送信者自身を入れる
- 受信者がメッセージを閲覧したら、`readBy` に追加
- **未読判定**: `readBy` に自分の userId が含まれていなければ未読
- **既読表示**: `readBy.length > 1` なら「相手に読まれた」と判定（DM の場合）

### TTL によるゾンビ接続の自動削除

WebSocket 接続は、ネットワーク断やブラウザクラッシュで `$disconnect` が呼ばれないことがあります。

```typescript
// 接続時に TTL を設定（24時間後に自動削除）
{
  PK: `CONNECTION#${connectionId}`,
  SK: 'METADATA',
  ttl: Math.floor(Date.now() / 1000) + 86400,  // Unix秒
}
```

DynamoDB の TTL 機能が期限切れのレコードをバックグラウンドで削除するため、ゾンビ接続が永久に残ることを防ぎます。

### GSI（グローバルセカンダリインデックス）

メインテーブルの PK/SK だけではカバーできないアクセスパターンに GSI を使います：

| インデックス | PK | SK | 用途 |
|-------------|----|----|------|
| GSI1 | `GSI1PK` | `GSI1SK` | ユーザーのルーム一覧を最終メッセージ日時でソート |
| GSI2 | `GSI2PK` | `GSI2SK` | 地理情報による検索（アクティビティ用） |

チャットルーム参加レコードに GSI1 属性を付与することで、ユーザーの参加ルームを「最後のメッセージが新しい順」で取得できます：

```typescript
{
  PK: `USER#${userId}`,
  SK: `CHATROOM#${chatRoomId}`,
  GSI1PK: `USERROOMS#${userId}`,
  GSI1SK: lastMessageAt,  // 更新されるたびに上書き
}
```

## CDK で DynamoDB テーブルを定義する

```typescript
// cdk/lib/stacks/database-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, 'AppTable', {
      tableName: `MyApp-Table-${props.envName}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy:
        props.envName === 'prod'
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // GSI1: ユーザーのルーム一覧（最終メッセージ日時でソート）
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });
  }
}
```

ポイント：

- **`PAY_PER_REQUEST`**: チャットのトラフィックは予測しにくいため、オンデマンド課金が安全
- **`timeToLiveAttribute: 'ttl'`**: 接続レコードの自動削除に必要
- **`RETAIN` / `DESTROY`**: 本番環境のデータは削除防止、開発環境はクリーンアップ可能に

## CDK で WebSocket API を定義する

```typescript
// cdk/lib/stacks/websocket-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class WebSocketStack extends cdk.Stack {
  public readonly webSocketEndpoint: string;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    // 1. WebSocket API を作成
    const webSocketApi = new apigatewayv2.CfnApi(this, 'WebSocketApi', {
      name: `MyApp-WebSocket-${props.envName}`,
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    // 2. Lambda 実行ロール（DynamoDB + 接続管理権限）
    const lambdaRole = new iam.Role(this, 'WebSocketLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    props.table.grantReadWriteData(lambdaRole);

    // PostToConnectionCommand に必要な権限
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*`,
        ],
      })
    );

    // 3. Lambda 関数を定義（4つのルートハンドラー）
    const handlers = ['connect', 'disconnect', 'sendMessage', 'default'];
    const functions = handlers.map(
      (name) =>
        new lambda.Function(this, `${name}Function`, {
          runtime: lambda.Runtime.NODEJS_20_X,
          handler: `${name}.handler`,
          code: lambda.Code.fromAsset('backend/functions/websocket'),
          role: lambdaRole,
          environment: {
            TABLE_NAME: props.table.tableName,
            // connect のみ Cognito 設定が必要
            ...(name === 'connect' && {
              USER_POOL_ID: props.userPool.userPoolId,
              CLIENT_ID: props.userPoolClient.userPoolClientId,
            }),
          },
          timeout: cdk.Duration.seconds(30),
        })
    );

    // 4. API Gateway → Lambda 統合を作成
    const integrations = functions.map(
      (fn, i) =>
        new apigatewayv2.CfnIntegration(this, `${handlers[i]}Integration`, {
          apiId: webSocketApi.ref,
          integrationType: 'AWS_PROXY',
          integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${fn.functionArn}/invocations`,
        })
    );

    // 5. ルートを定義
    const routeKeys = ['$connect', '$disconnect', 'sendMessage', '$default'];
    const routes = routeKeys.map(
      (key, i) =>
        new apigatewayv2.CfnRoute(this, `${handlers[i]}Route`, {
          apiId: webSocketApi.ref,
          routeKey: key,
          target: `integrations/${integrations[i].ref}`,
        })
    );

    // 6. デプロイとステージ
    const deployment = new apigatewayv2.CfnDeployment(this, 'Deployment', {
      apiId: webSocketApi.ref,
    });
    routes.forEach((route) => deployment.addDependency(route));

    new apigatewayv2.CfnStage(this, 'Stage', {
      apiId: webSocketApi.ref,
      stageName: props.envName,
      deploymentId: deployment.ref,
      defaultRouteSettings: {
        throttlingBurstLimit: 500,
        throttlingRateLimit: 1000,
      },
    });

    this.webSocketEndpoint = `wss://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${props.envName}`;
  }
}
```

### CDK で注意すべきポイント

**`CfnApi` を使う理由**: CDK の L2 コンストラクト（`WebSocketApi`）もありますが、ルートの細かい制御や `routeSelectionExpression` の指定には L1 の `CfnApi` のほうが明示的で理解しやすいです。

**`execute-api:ManageConnections` 権限**: sendMessage Lambda がチャットルームの全参加者にメッセージをプッシュするために必須。これを忘れると `403 Forbidden` になります。

**デプロイの依存関係**: ルートが作成される前にデプロイが走ると、空の API がデプロイされます。`deployment.addDependency(route)` を忘れずに。

## スタック構成とデプロイ順序

```typescript
// cdk/bin/cdk.ts
const authStack = new AuthStack(app, `Auth-${env}`, { ... });
const databaseStack = new DatabaseStack(app, `Database-${env}`, { ... });
const apiStack = new ApiStack(app, `Api-${env}`, {
  userPool: authStack.userPool,
  table: databaseStack.table,
});
const webSocketStack = new WebSocketStack(app, `WebSocket-${env}`, {
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  table: databaseStack.table,
});
const frontendStack = new FrontendStack(app, `Frontend-${env}`, {
  apiEndpoint: apiStack.apiEndpoint,
  webSocketEndpoint: webSocketStack.webSocketEndpoint,
});

// 依存関係
webSocketStack.addDependency(authStack);
webSocketStack.addDependency(databaseStack);
frontendStack.addDependency(webSocketStack);
```

デプロイ順序を図にすると：

```
Auth ──→ WebSocket ──→ Frontend
Database ──↗           ↗
Storage ──→ Api ───────↗
```

WebSocket Stack は Auth（JWT 検証用）と Database（接続情報保存用）に依存します。Frontend は WebSocket エンドポイントの URL を環境変数として受け取るため、WebSocket Stack の後にデプロイされます。

## まとめ

第1回では、リアルタイムチャットのインフラ基盤を設計しました：

- **API Gateway WebSocket API** は `$request.body.action` でルーティングし、`$connect` / `$disconnect` / `sendMessage` / `$default` の4ルートで構成
- **DynamoDB Single Table Design** で接続・メッセージ・チャットルーム・既読状態を1テーブルに収め、PK/SK の設計でアクセスパターンをカバー
- **TTL** でゾンビ接続を自動削除し、**GSI** でルーム一覧のソートを実現
- **CDK** でインフラをコード管理し、スタック間の依存関係を明示的に定義

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> AWS CDKv2 (TypeScript) でリアルタイムチャット用のインフラを構築してください。
>
> 要件：
> - API Gateway WebSocket API を作成。routeSelectionExpression は `$request.body.action`
> - ルートは $connect, $disconnect, sendMessage, $default の4つ。それぞれ Lambda (Node.js 20.x) にルーティング
> - DynamoDB は Single Table Design (PK/SK: String, PAY_PER_REQUEST)。TTL 属性 `ttl` を有効化
> - GSI1 (GSI1PK/GSI1SK) を追加。ユーザーのチャットルーム一覧を最終メッセージ日時でソートするため
> - Lambda ロールには DynamoDB 読み書き + `execute-api:ManageConnections` 権限を付与
> - connect Lambda のみ Cognito USER_POOL_ID と CLIENT_ID を環境変数に渡す
> - CfnDeployment は全ルート作成後に依存関係を設定すること
> - テーブルの removalPolicy は prod なら RETAIN、それ以外は DESTROY
>
> キー設計：
> - 接続管理: PK=CONNECTION#{connId} SK=METADATA / PK=USER#{userId} SK=CONNECTION#{connId}
> - チャットルーム: PK=CHATROOM#{roomId} SK=METADATA
> - メッセージ: PK=CHATROOM#{roomId} SK=MESSAGE#{timestamp}#{messageId}
> - 既読: 各メッセージの readBy 配列に userId を追加
> - ルーム参加: PK=USER#{userId} SK=CHATROOM#{roomId}, GSI1PK=USERROOMS#{userId}

---

次回: [第2回: 接続管理・メッセージ配信編](/posts/aws-realtime-chat-part2) では、$connect/$disconnect Lambda の JWT 認証と sendMessage のブロードキャスト実装を解説します。
