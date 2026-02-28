---
title: "CDKでWebSocket APIを構築する — サーバーレスチャットのインフラ定義"
emoji: "🏗️"
type: "tech"
topics: ["AWS", "CDK", "API Gateway", "Lambda", "WebSocket"]
published: true
category: "HowTo"
date: "2026-03-01"
description: "AWS CDKでAPI Gateway WebSocket APIを定義する方法を解説。4つのルート（$connect/$disconnect/sendMessage/$default）のLambda統合、IAMポリシー、デプロイ設定まで"
series: "AWSサーバーレスチャット実装"
seriesOrder: 3
coverImage: "/images/posts/aws-serverless-chat-part3-cover.jpg"
---

> **このシリーズ: 全5回**
> 1. [第1回: リアルタイム通信の選択肢 — ポーリング・SSE・WebSocketを比較する](/posts/aws-serverless-chat-part1)
> 2. [第2回: DynamoDB Single Table Designでチャットを設計する](/posts/aws-serverless-chat-part2)
> 3. CDKでWebSocket APIを構築する — サーバーレスチャットのインフラ定義 ← 今ここ
> 4. [第4回: WebSocket Lambdaの実装 — JWT認証・ブロードキャスト・切断処理](/posts/aws-serverless-chat-part4)
> 5. [第5回: ReactでリアルタイムチャットUIを作る](/posts/aws-serverless-chat-part5)

## 概要

前回はDynamoDB Single Table Designでチャットのデータモデルを設計した。今回は、そのデータを読み書きするWebSocket APIのインフラを **AWS CDK** で定義する。

API Gateway WebSocket APIには REST API にはない独特の概念がある:
- **ルート**（`$connect`, `$disconnect`, `sendMessage`, `$default`）
- **ルートセレクション式**（どのルートにメッセージを振り分けるか）
- **接続管理API**（`@connections` でサーバーからクライアントにpush）

この記事では、CDKのL1コンストラクト（`Cfn*`）を使ってこれらを構築する方法を、コードの1行1行の意味を含めて解説する。

## こんな人向け

- CDKでWebSocket APIを構築したことがない
- REST APIとWebSocket APIの設定の違いを理解したい
- L1（CfnApi）とL2（WebSocketApi）のどちらを使うべきか迷っている
- `execute-api:ManageConnections` の意味が分からない

## API Gateway WebSocket APIの構造

REST APIとWebSocket APIの構造を比べると、違いが分かりやすい:

```
REST API:                              WebSocket API:
┌─────────────┐                        ┌─────────────────────┐
│ API         │                        │ API                 │
│  ├─ /users  │ (パス)                 │  ├─ $connect        │ (接続時)
│  │  ├─ GET  │ (HTTPメソッド)         │  ├─ $disconnect     │ (切断時)
│  │  └─ POST │                        │  ├─ sendMessage     │ (カスタム)
│  └─ /items  │                        │  └─ $default        │ (その他)
│     └─ GET  │                        │                     │
└─────────────┘                        └─────────────────────┘

リクエスト: GET /users                 リクエスト: {"action":"sendMessage",...}
→ パスとメソッドでルーティング         → bodyのactionフィールドでルーティング
```

WebSocket APIでは**パスやHTTPメソッドの概念がない**。代わりに、メッセージのJSONから特定のフィールド（`action`）を取り出してルーティングする。これが **ルートセレクション式（Route Selection Expression）** だ。

## 4つのルートの役割

| ルート | いつ呼ばれるか | 主な処理 |
|--------|-------------|----------|
| `$connect` | クライアントがWebSocket接続を開始したとき | JWT検証、接続情報をDynamoDBに保存 |
| `$disconnect` | 接続が切断されたとき | DynamoDBから接続情報を削除 |
| `sendMessage` | `{"action":"sendMessage",...}` を受信したとき | メッセージ保存、参加者全員に配信 |
| `$default` | 上記のどれにもマッチしないメッセージ | ログ出力（開発時のデバッグ用） |

```
クライアント                     API Gateway                Lambda

── WebSocket接続要求 ──────▶ ── $connect ──────────▶ connect.ts
                                                    (JWT検証 + DB保存)

── {"action":"sendMessage",  ── sendMessage ───────▶ sendMessage.ts
    "chatRoomId":"room-xyz",                         (保存 + ブロードキャスト)
    "content":"こんにちは"} ▶

── (ブラウザ閉じる) ────────▶ ── $disconnect ────────▶ disconnect.ts
                                                    (DB削除)

── {"action":"unknown"} ───▶ ── $default ──────────▶ default.ts
                                                    (ログ出力)
```

## CDK実装: WebSocket Stackの全体像

### L1 vs L2 コンストラクト

CDKの `aws-apigatewayv2` モジュールには2つのレベルがある:

| レベル | クラス例 | 特徴 |
|--------|---------|------|
| **L1**（CloudFormation直訳） | `CfnApi`, `CfnRoute`, `CfnIntegration` | CloudFormationのリソースをそのままTypeScriptで書ける。冗長だが自由度が高い |
| **L2**（高レベル抽象化） | `WebSocketApi`, `WebSocketStage` | 簡潔に書けるが、細かい設定ができない場合がある |

今回は **L1を使う**。理由は:
- ルートごとのスロットリング設定など、L2では露出していない設定がある
- CloudFormationの概念と1対1対応するので、AWSドキュメントとの照合がしやすい
- トラブルシュート時にCloudFormationテンプレートを直接読める

### Stack全体のコード

```typescript
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WebSocketStackProps extends cdk.StackProps {
  envName: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  table: dynamodb.Table;
}

export class WebSocketStack extends cdk.Stack {
  public readonly webSocketApi: apigatewayv2.CfnApi;
  public readonly webSocketEndpoint: string;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    // ... 以下で各リソースを定義
  }
}
```

Props で他のスタックからの依存リソース（`userPool`, `table`）を受け取る。CDKのスタック分割はドメインごと（Database, Auth, WebSocket, API）にするのが管理しやすい。

## Step 1: WebSocket APIの作成

```typescript
this.webSocketApi = new apigatewayv2.CfnApi(this, 'WebSocketApi', {
  name: `Connect40-WebSocket-${props.envName}`,
  protocolType: 'WEBSOCKET',
  routeSelectionExpression: '$request.body.action',
});
```

**`routeSelectionExpression: '$request.body.action'`** が重要。クライアントから送られるJSONの `action` フィールドの値を見て、どのルートに振り分けるかを決める:

```json
// クライアントが送るJSON
{"action": "sendMessage", "chatRoomId": "room-xyz", "content": "こんにちは"}
//          ↑ この値が "sendMessage" ルートにマッチ
```

`$request.body.action` 以外のフィールドも指定できるが、`action` が慣例。

## Step 2: Lambda関数の定義

4つのルートに対応する4つのLambda関数を定義する。共通のIAMロールを使い回す:

```typescript
// Lambda共通ロール
const lambdaRole = new iam.Role(this, 'WebSocketLambdaRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName(
      'service-role/AWSLambdaBasicExecutionRole'
    ),
  ],
});

// DynamoDBの読み書き権限
props.table.grantReadWriteData(lambdaRole);

// ★ WebSocket接続への書き戻し権限
lambdaRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ['execute-api:ManageConnections'],
    resources: [
      `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*`,
    ],
  })
);
```

### `execute-api:ManageConnections` とは

REST APIでは「リクエストを受けてレスポンスを返す」で完結する。しかしWebSocket APIでは、Lambda関数側から **接続中のクライアントにメッセージを送り返す** 必要がある。これに必要な権限が `execute-api:ManageConnections` だ。

```
通常のREST API:
  クライアント ──リクエスト──▶ Lambda ──レスポンス──▶ クライアント

WebSocket API:
  クライアントA ──メッセージ──▶ Lambda ──────────────────────────┐
                                 │                              │
                                 ├──▶ DynamoDBに保存            │
                                 │                              │
                                 ├──▶ クライアントAに送信 ◀──────┘
                                 ├──▶ クライアントBに送信  ← これにManageConnections権限が必要
                                 └──▶ クライアントCに送信
```

この権限がないと、Lambda内で `PostToConnectionCommand` を実行したときに `AccessDeniedException` になる。

### Lambda関数4本の定義

```typescript
// Connect Handler
const connectFunction = new lambda.Function(this, 'ConnectFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'connect.handler',
  code: lambda.Code.fromAsset(
    path.join(__dirname, '../../../backend/functions/websocket')
  ),
  role: lambdaRole,
  environment: {
    TABLE_NAME: props.table.tableName,
    USER_POOL_ID: props.userPool.userPoolId,   // JWT検証用
    CLIENT_ID: props.userPoolClient.userPoolClientId,
  },
  timeout: cdk.Duration.seconds(30),
});

// Disconnect / SendMessage / Default も同様に定義
// （handler名とenvironmentが異なるだけ）
```

**注意**: `connect` ハンドラーだけ `USER_POOL_ID` と `CLIENT_ID` の環境変数が必要。JWT検証は接続時（`$connect`）にのみ行い、以降のメッセージでは接続IDでユーザーを特定するため。

## Step 3: Integration（Lambda統合）の作成

各ルートとLambda関数を紐付けるために、**Integration** リソースを作る:

```typescript
const connectIntegration = new apigatewayv2.CfnIntegration(
  this, 'ConnectIntegration', {
    apiId: this.webSocketApi.ref,
    integrationType: 'AWS_PROXY',
    integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${connectFunction.functionArn}/invocations`,
  }
);
```

**`integrationType: 'AWS_PROXY'`**: Lambda関数にイベント全体（ヘッダー、ボディ、リクエストコンテキスト等）をそのまま渡す。REST APIの `Lambda Proxy Integration` と同じ概念。

**`integrationUri`**: Lambda関数を呼び出すためのAPI Gateway内部URI。このフォーマットはAWSの仕様で固定。

```
// 4つのIntegrationを作成
connectIntegration     → connectFunction
disconnectIntegration  → disconnectFunction
sendMessageIntegration → sendMessageFunction
defaultIntegration     → defaultFunction
```

## Step 4: ルートの作成

ルートはIntegrationとルートキーを紐付ける:

```typescript
const connectRoute = new apigatewayv2.CfnRoute(this, 'ConnectRoute', {
  apiId: this.webSocketApi.ref,
  routeKey: '$connect',
  target: `integrations/${connectIntegration.ref}`,
});

const sendMessageRoute = new apigatewayv2.CfnRoute(this, 'SendMessageRoute', {
  apiId: this.webSocketApi.ref,
  routeKey: 'sendMessage',  // ← action の値と一致
  target: `integrations/${sendMessageIntegration.ref}`,
});

// $disconnect, $default も同様
```

`$connect` と `$disconnect` はAPI Gatewayの予約ルートキー。`sendMessage` はカスタムルートで、`routeSelectionExpression` で指定した `$request.body.action` の値と一致するものが呼ばれる。

## Step 5: Lambda呼び出し権限

API GatewayがLambda関数を呼び出すための権限を付与する:

```typescript
connectFunction.grantInvoke(
  new iam.ServicePrincipal('apigateway.amazonaws.com')
);
disconnectFunction.grantInvoke(
  new iam.ServicePrincipal('apigateway.amazonaws.com')
);
sendMessageFunction.grantInvoke(
  new iam.ServicePrincipal('apigateway.amazonaws.com')
);
defaultFunction.grantInvoke(
  new iam.ServicePrincipal('apigateway.amazonaws.com')
);
```

これを忘れると、API GatewayからLambda関数を呼び出せず `Internal Server Error` になる。CloudWatch Logsにもエラーが出ないため、原因特定が難しいハマりポイント。

## Step 6: デプロイとステージ

```typescript
// Deployment（ルート定義の「スナップショット」）
const deployment = new apigatewayv2.CfnDeployment(
  this, 'WebSocketDeployment', {
    apiId: this.webSocketApi.ref,
  }
);

// ルートが先に作成されていないとデプロイが空になる
deployment.addDependency(connectRoute);
deployment.addDependency(disconnectRoute);
deployment.addDependency(sendMessageRoute);
deployment.addDependency(defaultRoute);

// Stage（デプロイのエイリアス）
const stage = new apigatewayv2.CfnStage(this, 'WebSocketStage', {
  apiId: this.webSocketApi.ref,
  stageName: props.envName,  // 'dev' or 'prod'
  deploymentId: deployment.ref,
  defaultRouteSettings: {
    throttlingBurstLimit: 500,
    throttlingRateLimit: 1000,
  },
});
```

### `addDependency` が必要な理由

CloudFormationはリソースを並列で作成する。Deploymentが先に作られてしまうと、ルートが0本の状態のスナップショットが取られて、APIが動かない。**明示的な依存関係** を設定して順序を保証する。

```
作成順序:
  API → Lambda → Integration → Route → Deployment → Stage
                                  ↑ addDependency で順序保証
```

### WebSocketエンドポイント

```typescript
this.webSocketEndpoint =
  `wss://${this.webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${props.envName}`;

new cdk.CfnOutput(this, 'WebSocketEndpoint', {
  value: this.webSocketEndpoint,
  exportName: `Connect40-WebSocketEndpoint-${props.envName}`,
});
```

出力例: `wss://abc123.execute-api.ap-northeast-1.amazonaws.com/dev`

クライアントはこのURLに対して `new WebSocket('wss://...')` で接続する。

## 全体のリソース関係図

```
WebSocketStack
│
├─ CfnApi (WebSocket API)
│   └─ routeSelectionExpression: '$request.body.action'
│
├─ IAM Role (Lambda共通)
│   ├─ AWSLambdaBasicExecutionRole
│   ├─ DynamoDB ReadWrite
│   └─ execute-api:ManageConnections
│
├─ Lambda Functions (×4)
│   ├─ connect.handler    ← USER_POOL_ID, CLIENT_ID
│   ├─ disconnect.handler
│   ├─ sendMessage.handler
│   └─ default.handler
│
├─ CfnIntegration (×4)
│   └─ AWS_PROXY → 各Lambda
│
├─ CfnRoute (×4)
│   ├─ $connect → connectIntegration
│   ├─ $disconnect → disconnectIntegration
│   ├─ sendMessage → sendMessageIntegration
│   └─ $default → defaultIntegration
│
├─ CfnDeployment
│   └─ depends on: 全ルート
│
└─ CfnStage
    └─ stageName: 'dev' / 'prod'
```

## まとめ

| 構成要素 | 役割 |
|---------|------|
| `CfnApi` | WebSocket API本体。ルートセレクション式でメッセージの振り分けルールを定義 |
| `CfnIntegration` | ルートとLambda関数を接続するパイプ |
| `CfnRoute` | `$connect`/`$disconnect`/カスタム/`$default` の4種類 |
| `CfnDeployment` | ルート設定のスナップショット。ルートへの依存関係を明示 |
| `CfnStage` | デプロイのエイリアス。スロットリング設定を含む |
| IAMポリシー | `execute-api:ManageConnections` がWebSocket特有の必須権限 |

REST APIとの最大の違いは **ルートセレクション式** と **`ManageConnections` 権限** の2つ。この2つを理解していれば、CDKでの構築はスムーズに進む。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> CDKでAPI Gateway WebSocket APIスタックを作成してほしい。
>
> 要件:
> - L1コンストラクト（CfnApi, CfnRoute, CfnIntegration, CfnDeployment, CfnStage）を使用
> - routeSelectionExpression は `$request.body.action`
> - ルート: `$connect`, `$disconnect`, `sendMessage`, `$default` の4つ
> - 各ルートに対応するLambda関数を作成（Node.js 20.x）
> - Lambda共通IAMロールに以下の権限:
>   - AWSLambdaBasicExecutionRole
>   - DynamoDBテーブルへのReadWrite（propsで受け取る）
>   - execute-api:ManageConnections（WebSocket接続へのpush送信用）
> - connectハンドラーのみ USER_POOL_ID と CLIENT_ID の環境変数が必要
> - DeploymentにRouteへのaddDependencyを設定（空デプロイ防止）
> - StageにThrottling設定（burst: 500, rate: 1000）
>
> propsとしてenvName, userPool, userPoolClient, tableを受け取る設計で。

### エージェントに指示するときの注意点

- CDKのL2 `WebSocketApi` を使うと簡潔に書けるが、Deploymentの依存関係やStageのスロットリング設定で詰まることがある。L1かL2かを明示する
- `execute-api:ManageConnections` を忘れるとメッセージ送信時に403エラーが出る。エラーメッセージだけ見るとIAM権限の問題と分かりにくいので、最初から権限に含めるよう指示する
- `grantInvoke(apigateway.amazonaws.com)` も忘れやすい。忘れるとAPI Gatewayからの呼び出しが `Internal Server Error` になり、Lambda側のログにも何も出ないため原因特定が困難

---

次回: [第4回: WebSocket Lambdaの実装 — JWT認証・ブロードキャスト・切断処理](/posts/aws-serverless-chat-part4) では、各Lambda関数の実装コードを解説します。`$connect` でのCognito JWT検証、`sendMessage` での全員配信、`GoneException` の処理など。
