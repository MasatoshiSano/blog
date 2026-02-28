---
title: "リアルタイム通信の選択肢 — ポーリング・SSE・WebSocketを比較する"
emoji: "⚡"
type: "tech"
topics: ["AWS", "WebSocket", "API Gateway", "Architecture", "Chat"]
published: true
category: "Architecture"
date: "2026-03-01"
description: "チャットアプリに必要なリアルタイム通信を、ポーリング・SSE・WebSocketの3方式で比較。API Gateway WebSocket APIを選んだ設計判断とコスト試算を解説"
series: "AWSサーバーレスチャット実装"
seriesOrder: 1
coverImage: "/images/posts/aws-serverless-chat-part1-cover.jpg"
---

> **このシリーズ: 全5回**
> 1. リアルタイム通信の選択肢 — ポーリング・SSE・WebSocketを比較する ← 今ここ
> 2. [第2回: DynamoDB Single Table Designでチャットを設計する](/posts/aws-serverless-chat-part2)
> 3. [第3回: CDKでWebSocket APIを構築する](/posts/aws-serverless-chat-part3)
> 4. [第4回: WebSocket Lambdaの実装 — JWT認証・ブロードキャスト・切断処理](/posts/aws-serverless-chat-part4)
> 5. [第5回: ReactでリアルタイムチャットUIを作る](/posts/aws-serverless-chat-part5)

## 概要

「チャットアプリを作りたい」と思ったとき、最初にぶつかるのが **「サーバーからクライアントへ、どうやってリアルタイムにデータを届けるか」** という問題だ。

HTTPは基本的に「クライアントが聞きに行く」プロトコルなので、サーバー側から能動的にデータを送る仕組みが必要になる。選択肢は大きく3つある:

1. **ポーリング**（Short Polling / Long Polling）
2. **Server-Sent Events（SSE）**
3. **WebSocket**

この記事では、それぞれの仕組み・メリット・デメリットを比較し、なぜAWSでチャットアプリを作る際にAPI Gateway WebSocket APIを選んだかを解説する。

## こんな人向け

- リアルタイム通信の方式を比較検討している
- AWS上でチャットやリアルタイム機能を設計しようとしている
- WebSocketを選ぶべきかSSEで十分か判断に迷っている
- API Gateway WebSocket APIのコスト感を知りたい

## 3つの方式を理解する

### 1. ポーリング（Polling）

最もシンプルな方式。クライアントが一定間隔でサーバーに「新しいデータありますか？」と聞きに行く。

```
┌─────────┐                          ┌─────────┐
│ Client  │ ── GET /messages ──────▶  │ Server  │
│         │ ◀── 200 (データなし) ──── │         │
│         │                           │         │
│  (3秒待つ)                          │         │
│         │                           │         │
│         │ ── GET /messages ──────▶  │         │
│         │ ◀── 200 (データなし) ──── │         │
│         │                           │         │
│  (3秒待つ)                          │         │
│         │                           │         │
│         │ ── GET /messages ──────▶  │         │
│         │ ◀── 200 (新着1件!) ────── │         │
└─────────┘                          └─────────┘
```

**Short Polling** は上図のように単純にタイマーで繰り返す方式。**Long Polling** はサーバー側でデータが来るまでレスポンスを保留する方式で、Short Pollingよりリアルタイム性は高いが、接続管理が複雑になる。

```typescript
// Short Polling の実装例
setInterval(async () => {
  const res = await fetch('/api/messages?since=' + lastTimestamp);
  const messages = await res.json();
  if (messages.length > 0) {
    displayMessages(messages);
    lastTimestamp = messages[messages.length - 1].timestamp;
  }
}, 3000); // 3秒ごとに問い合わせ
```

**メリット:**
- 実装が最もシンプル。通常のHTTP APIがそのまま使える
- ロードバランサーやキャッシュなど既存インフラとの相性が良い

**デメリット:**
- メッセージがない間も無駄なリクエストが飛ぶ（コストと負荷）
- ポーリング間隔 = 最大遅延。3秒間隔なら最大3秒のラグが発生する
- ユーザーが増えるとリクエスト数が爆発する

### 2. Server-Sent Events（SSE）

サーバーからクライアントへの**一方向**ストリーミング。HTTPの `text/event-stream` を使い、サーバーがデータを好きなタイミングで送れる。

```
┌─────────┐                          ┌─────────┐
│ Client  │ ── GET /stream ────────▶  │ Server  │
│         │ ◀── (接続維持) ────────── │         │
│         │                           │         │
│         │ ◀── data: メッセージ1 ─── │         │
│         │                           │         │
│         │ ◀── data: メッセージ2 ─── │         │
│         │                           │         │
│ 送信したい│ ── POST /messages ─────▶ │         │
│         │ ◀── 201 Created ───────── │         │
│         │                           │         │
│         │ ◀── data: メッセージ3 ─── │         │
└─────────┘                          └─────────┘
```

ポイントは **サーバー→クライアントは常時接続だが、クライアント→サーバーは通常のHTTPリクエスト** という点。受信用と送信用で経路が分かれる。

```typescript
// SSE の受信例
const eventSource = new EventSource('/api/stream');

eventSource.onmessage = (event) => {
  const message = JSON.parse(event.data);
  displayMessage(message);
};

// メッセージ送信は別途 POST
async function sendMessage(content: string) {
  await fetch('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}
```

**メリット:**
- ポーリングよりはるかに低レイテンシ（サーバーが即座にpush）
- HTTPベースなので、既存のインフラ（プロキシ、認証）と相性が良い
- ブラウザ標準API（`EventSource`）で簡単に使える
- 自動再接続がブラウザ側に組み込まれている

**デメリット:**
- **一方向通信**。クライアント→サーバーは別経路（POST）が必要
- HTTP/1.1ではブラウザあたり6接続の制限がある（複数タブで問題）
- AWSのAPI Gateway（REST/HTTP API）はSSEを**ネイティブサポートしていない**

### 3. WebSocket

クライアントとサーバー間で**双方向の常時接続**を確立する。HTTPでハンドシェイクした後、プロトコルをWebSocketに切り替える。

```
┌─────────┐                          ┌─────────┐
│ Client  │ ── HTTP Upgrade ───────▶  │ Server  │
│         │ ◀── 101 Switching ─────── │         │
│         │                           │         │
│         │ ══════ WebSocket ════════  │         │
│         │                           │         │
│         │ ──▶ {"action":"send",...}  │         │
│         │ ◀── {"type":"message",...} │         │
│         │ ◀── {"type":"message",...} │         │
│         │ ──▶ {"action":"send",...}  │         │
│         │                           │         │
│         │ ══════════════════════════ │         │
└─────────┘                          └─────────┘
```

1本の接続でメッセージの送信も受信もできる。チャットのような **「誰かが発言したら全員にすぐ届けたい」** ユースケースに最適。

```typescript
// WebSocket のクライアント例
const ws = new WebSocket('wss://example.com/ws?token=xxx');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  displayMessage(message);
};

// 同じ接続でメッセージ送信
function sendMessage(chatRoomId: string, content: string) {
  ws.send(JSON.stringify({
    action: 'sendMessage',
    chatRoomId,
    content,
  }));
}
```

**メリット:**
- **双方向リアルタイム通信**。送受信が1本の接続で完結
- レイテンシが最小（接続確立済みなのでHTTPのオーバーヘッドがない）
- サーバー側から任意のタイミングでpushできる

**デメリット:**
- ステートフルな接続管理が必要（どの接続が誰のものか追跡する）
- 接続が切れたときの再接続ロジックを自前で実装する必要がある
- ロードバランサーの設定がHTTPより複雑

## 比較表

| 項目 | Short Polling | Long Polling | SSE | WebSocket |
|------|:---:|:---:|:---:|:---:|
| **通信方向** | クライアント→サーバー | クライアント→サーバー | サーバー→クライアント | 双方向 |
| **レイテンシ** | 高（間隔依存） | 中 | 低 | 最低 |
| **サーバー負荷** | 高 | 中 | 低 | 低 |
| **実装の複雑さ** | 低 | 中 | 低 | 高 |
| **スケーラビリティ** | 悪い | 普通 | 良い | 良い |
| **AWS API Gateway対応** | REST/HTTP API | REST/HTTP API | 非対応 | WebSocket API |

## チャットアプリにWebSocketを選んだ理由

今回のプロジェクトでWebSocketを選んだ判断基準は3つ:

### 1. 双方向通信が必須

チャットは「メッセージの送信」と「他人のメッセージの受信」が同時に起きる。SSEだと送信は別途REST APIが必要になり、2つの経路を管理する複雑さが増す。WebSocketなら1本の接続で完結する。

### 2. API Gateway WebSocket APIの存在

AWS上でWebSocketサーバーを自前で立てる（EC2やECS上のSocket.ioなど）のは運用コストが高い。API Gateway WebSocket APIを使えば、**接続管理をAWSに任せて、Lambda関数でビジネスロジックだけに集中できる**。

```
ユーザー ←── WebSocket ──→ API Gateway ──→ Lambda ──→ DynamoDB
                            (接続管理は      (ビジネス    (データ
                             AWSが担当)       ロジック)    永続化)
```

### 3. サーバーレスでスケール

従来のWebSocketサーバー（Socket.io on EC2 など）では、接続数に応じてサーバー台数を増やし、接続の分散管理（Redis PubSubなど）が必要になる。API Gateway WebSocket APIはこれを自動的に処理してくれる。

## コスト試算: ポーリング vs WebSocket

具体的な数字で比較してみる。想定シナリオ:

- **100人のアクティブユーザー**が同時接続
- 各ユーザーが**1日平均30分**チャット利用
- メッセージ送信は**1人あたり1分に1回**

### ポーリングの場合（API Gateway HTTP API + Lambda）

```
リクエスト数: 100人 × 30分 × 20回/分(3秒間隔) = 60,000リクエスト/日
月間: 60,000 × 30日 = 1,800,000リクエスト

API Gateway HTTP API: $1.00/100万リクエスト = $1.80
Lambda: 1,800,000 × 128MB × 100ms = ~$0.30
```

ただし、そのうち実際にデータがあるのはごく一部。**大半が空振りリクエスト**。

### WebSocketの場合（API Gateway WebSocket API）

```
接続時間: 100人 × 30分 = 3,000分/日
月間: 3,000 × 30日 = 90,000分

接続料金: 90,000分 × $0.29/100万分 ≒ $0.03
メッセージ: 100人 × 30メッセージ × 30日 = 90,000メッセージ
メッセージ料金: 90,000 × $1.00/100万 ≒ $0.09
Lambda: メッセージ送信時のみ起動 = 90,000回 × 128MB × 200ms ≒ $0.02
```

| 方式 | 月間コスト概算 | 空振りリクエスト |
|------|:---:|:---:|
| ポーリング（3秒間隔） | ~$2.10 | 約97% |
| WebSocket | ~$0.14 | 0% |

小規模でもWebSocketの方がコスト効率が良く、ユーザー数が増えるほど差は広がる。

## SSEを選ばなかった理由

SSEは通知系やダッシュボードの自動更新には良い選択肢だが、チャットには2つの壁がある:

1. **API GatewayがSSE非対応**: AWSでSSEをやるなら、ALB + ECS/Fargate でサーバーを自前運用する必要がある。サーバーレスの恩恵を受けられない
2. **双方向通信ではない**: メッセージ送信用のREST APIを別途用意し、クライアント側で2つの接続を管理する必要がある

SSEが適しているケース:
- 株価のリアルタイム表示（サーバー→クライアントの一方向）
- ビルド進捗のストリーミング
- AIチャットのストリーミングレスポンス（タイピング風表示）

## まとめ

| 方式 | 適しているケース |
|------|-----------------|
| **ポーリング** | 更新頻度が低い、既存REST APIに追加、MVP |
| **SSE** | サーバーからの一方向push（通知、ストリーミング） |
| **WebSocket** | 双方向リアルタイム通信（チャット、ゲーム、コラボ編集） |

チャットアプリのように「双方向・低レイテンシ・多人数」が求められる場合、WebSocketが最適解。AWSならAPI Gateway WebSocket APIを使うことで、サーバーレスアーキテクチャの恩恵を受けながらリアルタイム通信を実現できる。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> AWSでリアルタイムチャット機能を作りたい。
> 技術選定として、API Gateway WebSocket APIを使う。理由は以下:
> - 双方向通信が必要（チャットなので送受信が同時発生）
> - サーバーレスでスケールさせたい（EC2やECSのサーバー管理を避ける）
> - ポーリングだと空振りリクエストが多くコスト非効率
>
> 構成:
> - API Gateway WebSocket API（$connect, $disconnect, sendMessage, $default の4ルート）
> - Lambda関数で各ルートを処理
> - DynamoDBで接続管理・メッセージ保存
> - Cognito JWTトークンで認証
>
> まずはCDKでWebSocket APIのインフラを定義するところから始めてほしい。

### エージェントに指示するときの注意点

- 「WebSocketでチャットを作って」だけだとSocket.ioやEC2ベースの実装になりがち。**API Gateway WebSocket API**を明示する
- API Gateway WebSocket APIでは認証方法が通常のREST APIと異なる。`$connect` ルートでクエリパラメータからトークンを取得する方式を指定しないと、Authorizerの設定で混乱する
- CDKの `apigatewayv2` モジュールには L1（CfnApi）と L2（WebSocketApi）の2レベルがある。L2の方が簡潔だが、細かい制御が必要ならL1を使う旨を伝える

---

次回: [第2回: DynamoDB Single Table Designでチャットを設計する](/posts/aws-serverless-chat-part2) では、1つのテーブルにコネクション・チャットルーム・メッセージをすべて詰め込むSingle Table Designの設計手法と、具体的なPK/SKパターンを解説します。
