---
title: "DynamoDB Single Table Designでチャットを設計する — PK/SKとアクセスパターン"
emoji: "🗄️"
type: "tech"
topics: ["AWS", "DynamoDB", "Database", "Architecture", "Chat"]
published: true
category: "Architecture"
date: "2026-03-01"
description: "DynamoDB Single Table Designのメリット・デメリットを解説し、チャットアプリのコネクション管理・ルーム・メッセージを1テーブルで設計する具体的なPK/SKパターンを紹介"
series: "AWSサーバーレスチャット実装"
seriesOrder: 2
coverImage: "/images/posts/aws-serverless-chat-part2-cover.jpg"
---

> **このシリーズ: 全5回**
> 1. [第1回: リアルタイム通信の選択肢 — ポーリング・SSE・WebSocketを比較する](/posts/aws-serverless-chat-part1)
> 2. DynamoDB Single Table Designでチャットを設計する — PK/SKとアクセスパターン ← 今ここ
> 3. [第3回: CDKでWebSocket APIを構築する](/posts/aws-serverless-chat-part3)
> 4. [第4回: WebSocket Lambdaの実装 — JWT認証・ブロードキャスト・切断処理](/posts/aws-serverless-chat-part4)
> 5. [第5回: ReactでリアルタイムチャットUIを作る](/posts/aws-serverless-chat-part5)

## 概要

前回の記事でリアルタイム通信にWebSocketを選んだ理由を解説した。今回は、そのWebSocketチャットの **データをどう保存するか** を設計する。

DynamoDBの **Single Table Design（STD）** は、すべてのエンティティを1つのテーブルに詰め込む設計手法だ。RDBの常識からすると異質に見えるが、サーバーレスアーキテクチャとの相性が抜群に良い。

この記事では、STDの考え方を整理した上で、チャットアプリに必要な6種類のエンティティを具体的なPK/SK値で設計する。

## こんな人向け

- DynamoDB Single Table Designの「なぜ1テーブル？」がピンと来ていない
- PK/SKの設計パターンを具体例で理解したい
- チャットアプリのデータモデリングに取り組んでいる
- GSI（Global Secondary Index）をいつ使うか判断に迷っている

## Single Table Designとは

### RDBとの根本的な違い

RDB（PostgreSQL、MySQLなど）では「エンティティごとに1テーブル」が基本:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   users     │  │  chatrooms  │  │  messages   │  │ connections │
├─────────────┤  ├─────────────┤  ├─────────────┤  ├─────────────┤
│ id          │  │ id          │  │ id          │  │ id          │
│ name        │  │ name        │  │ room_id(FK) │  │ user_id(FK) │
│ email       │  │ created_at  │  │ sender(FK)  │  │ connected_at│
│ ...         │  │ ...         │  │ content     │  │ ...         │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

必要なデータは `JOIN` で結合する。

一方、DynamoDB Single Table Designでは **すべてのエンティティが1つのテーブルに同居** する:

```
┌────────────────────────────────────────────────────────────────┐
│                     Connect40-Table                            │
├───────────────────────┬───────────────────┬───────────────────┤
│ PK                    │ SK                │ その他の属性...    │
├───────────────────────┼───────────────────┼───────────────────┤
│ USER#user-001         │ PROFILE           │ nickname, email   │
│ USER#user-001         │ CHATROOM#room-abc │ joinedAt          │
│ USER#user-001         │ CONNECTION#conn-x │ connectedAt       │
│ CHATROOM#room-abc     │ METADATA          │ name, type        │
│ CHATROOM#room-abc     │ MESSAGE#170923... │ content, senderId │
│ CONNECTION#conn-x     │ METADATA          │ userId            │
└───────────────────────┴───────────────────┴───────────────────┘
```

**PK（パーティションキー）とSK（ソートキー）の組み合わせ** でエンティティの種類とアクセスパターンを表現する。JOINは使わない。

### なぜ1テーブルにまとめるのか

DynamoDBは **JOINができない**。テーブルを分けると、関連データを取得するために複数のテーブルに対して別々のリクエストが必要になる:

```
❌ テーブルを分けた場合（Multi Table Design）

「ユーザーの参加チャットルーム一覧を取得」
  → 1. participations テーブルから user_id で検索
  → 2. 取得した room_id ごとに chatrooms テーブルを検索
  → 3. 各ルームの最新メッセージを messages テーブルから検索
  = 合計 N+1 回のリクエスト
```

```
✅ Single Table Design の場合

「ユーザーの参加チャットルーム一覧を取得」
  → 1. PK = "USER#user-001" AND begins_with(SK, "CHATROOM#") でQuery
  = 1回のリクエストで全部取れる
```

1テーブルにまとめることで、**1回のQuery操作で関連データをまとめて取得** できる。これがSTDの最大のメリットだ。

## メリットとデメリット

### メリット

| メリット | 説明 |
|---------|------|
| **クエリ効率** | 関連データを1回のQueryで取得。N+1問題が起きない |
| **コスト削減** | リクエスト数が減る = DynamoDBのRCU/WCU消費が減る |
| **運用の簡素化** | テーブルが1つなのでバックアップ・監視・IAMポリシーの管理が楽 |
| **トランザクション** | 複数エンティティへの書き込みを `TransactWriteItems` で1テーブル内で完結できる |
| **スケーラビリティ** | DynamoDBのオンデマンドキャパシティで、テーブル設計を変えずにスケール |

### デメリット

| デメリット | 説明 |
|-----------|------|
| **設計の難しさ** | アクセスパターンを先に決めないと設計できない。RDBのように「とりあえずテーブルを作ってSQLで考える」ができない |
| **可読性の低さ** | テーブルをDynamoDBコンソールで見ると、異なるエンティティが混在していて一見カオス |
| **柔軟性の制限** | 後からアクセスパターンを追加しにくい。GSIの追加で対応できるが限界がある |
| **学習コスト** | RDBの経験者ほど「テーブルを分けたい」衝動と戦うことになる |

### STDが向いているケース / 向いていないケース

```
向いている:
  ✅ アクセスパターンが事前に明確（チャット、ECサイト、IoTデータ）
  ✅ サーバーレスアーキテクチャ（Lambda + DynamoDB）
  ✅ 読み書きのレイテンシが重要

向いていない:
  ❌ アクセスパターンが頻繁に変わるプロトタイプ段階
  ❌ 複雑なアドホッククエリが必要（分析・レポート用途）
  ❌ チームにDynamoDB経験者がいない初期段階
```

## 設計の出発点: アクセスパターンを列挙する

STDでは **「どんなクエリを投げたいか」を先に決めて、そこからテーブル構造を逆算する**。これがRDB（まずテーブルを正規化→SQLでアクセス）との最大の違い。

チャットアプリで必要なアクセスパターンを洗い出す:

| # | アクセスパターン | 操作 |
|---|-----------------|------|
| 1 | WebSocket接続IDからユーザーIDを取得 | Get |
| 2 | ユーザーIDからアクティブな接続一覧を取得 | Query |
| 3 | チャットルームのメタデータを取得 | Get |
| 4 | チャットルームのメッセージを時系列で取得 | Query |
| 5 | ユーザーが参加しているルーム一覧を取得 | Query |
| 6 | チャットルームの最新メッセージを取得 | Get |

この6つのアクセスパターンを **PK/SKの設計で全部カバー** する。

## エンティティ設計: 6種類のデータ

### 全体マップ

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          Connect40-Table                                   │
├──────────────────────────┬──────────────────────────┬──────────────────────┤
│ PK                       │ SK                       │ 主な属性             │
╞══════════════════════════╪══════════════════════════╪══════════════════════╡
│                          │                          │                      │
│ ① CONNECTION#abc-123     │ METADATA                 │ userId, connectedAt  │
│                          │                          │ ttl (24h自動削除)    │
├──────────────────────────┼──────────────────────────┼──────────────────────┤
│                          │                          │                      │
│ ② USER#user-001          │ CONNECTION#abc-123       │ connectionId         │
│   USER#user-001          │ CONNECTION#def-456       │ connectedAt, ttl     │
│                          │                          │                      │
├──────────────────────────┼──────────────────────────┼──────────────────────┤
│                          │                          │                      │
│ ③ USER#user-001          │ CHATROOM#room-xyz        │ chatRoomId, joinedAt │
│   USER#user-001          │ CHATROOM#room-abc        │ GSI1PK, GSI1SK       │
│                          │                          │                      │
├──────────────────────────┼──────────────────────────┼──────────────────────┤
│                          │                          │                      │
│ ④ CHATROOM#room-xyz      │ METADATA                 │ name, participantIds │
│                          │                          │ type, activityId     │
│                          │                          │                      │
├──────────────────────────┼──────────────────────────┼──────────────────────┤
│                          │                          │                      │
│ ⑤ CHATROOM#room-xyz      │ MESSAGE#1709234567#msg-1 │ senderId, content    │
│   CHATROOM#room-xyz      │ MESSAGE#1709234890#msg-2 │ messageType, readBy  │
│   CHATROOM#room-xyz      │ MESSAGE#1709235100#msg-3 │ createdAt, timestamp │
│                          │                          │                      │
├──────────────────────────┼──────────────────────────┼──────────────────────┤
│                          │                          │                      │
│ ⑥ CHATROOM#room-xyz      │ LASTMESSAGE              │ lastMessageAt        │
│                          │                          │ lastMessage (先頭100文字) │
│                          │                          │                      │
└──────────────────────────┴──────────────────────────┴──────────────────────┘
```

### ① コネクション管理 — `CONNECTION#{connectionId}`

WebSocket接続を管理するレコード。API Gatewayが発行する `connectionId` をキーにして、接続の持ち主（userId）を引ける。

```typescript
// connect.ts でWebSocket接続時に書き込む
{
  PK: `CONNECTION#${connectionId}`,
  SK: 'METADATA',
  Type: 'Connection',
  connectionId,
  userId,           // JWT検証で取得したCognito sub
  connectedAt: now,
  ttl: Math.floor(Date.now() / 1000) + 86400, // 24時間後に自動削除
}
```

**なぜTTLを設定するのか**: WebSocket接続は予期せず切断されることがある（ネットワーク障害、ブラウザクラッシュ等）。`$disconnect` が呼ばれない場合、レコードがゴミとして残り続ける。TTLで24時間後に自動削除することで、ゴミレコードの蓄積を防ぐ。

**アクセスパターン #1**: `PK = CONNECTION#abc-123` で Get → そのconnectionIdの持ち主のuserIdが分かる。メッセージ送信時に「この接続は誰のものか」を特定するために使う。

### ② ユーザー→コネクション逆引き — `USER#{userId} / CONNECTION#{connectionId}`

①の逆引き用レコード。1人のユーザーが複数デバイス（PC + スマホ）で接続している場合、複数のコネクションレコードが並ぶ。

```typescript
// connect.ts で①と同時に書き込む
{
  PK: `USER#${userId}`,
  SK: `CONNECTION#${connectionId}`,
  Type: 'UserConnection',
  connectionId,
  connectedAt: now,
  ttl: Math.floor(Date.now() / 1000) + 86400,
}
```

**なぜ逆引きが必要なのか**: メッセージをブロードキャストするとき、「このユーザーのアクティブな接続一覧」が必要になる。①だけだと connectionId → userId の片方向しか引けない。

```
メッセージ送信のフロー:

1. チャットルームの参加者一覧を取得 → [user-001, user-002, user-003]
2. 各ユーザーのアクティブ接続を取得:
   PK = USER#user-001, begins_with(SK, "CONNECTION#") → [conn-a, conn-b]
   PK = USER#user-002, begins_with(SK, "CONNECTION#") → [conn-c]
   PK = USER#user-003, begins_with(SK, "CONNECTION#") → [] (オフライン)
3. conn-a, conn-b, conn-c にメッセージを配信
```

**アクセスパターン #2**: `PK = USER#user-001 AND begins_with(SK, "CONNECTION#")` で Query → そのユーザーの全アクティブ接続が取れる。

### ③ チャット参加記録 — `USER#{userId} / CHATROOM#{chatRoomId}`

ユーザーがどのチャットルームに参加しているかを記録する。チャット一覧画面で使う。

```typescript
// createRoom.ts でルーム作成時に参加者全員分を書き込む
{
  PK: `USER#${participantId}`,
  SK: `CHATROOM#${chatRoomId}`,
  GSI1PK: `USERROOMS#${participantId}`,
  GSI1SK: now,  // 参加日時でソート可能
  Type: 'ChatParticipation',
  chatRoomId,
  participantId,
  joinedAt: now,
}
```

**ポイント: 同じPKの配下にコネクションとチャットルームが混在する**

```
USER#user-001 / CONNECTION#conn-a    ← ②のレコード
USER#user-001 / CONNECTION#conn-b    ← ②のレコード
USER#user-001 / CHATROOM#room-xyz    ← ③のレコード
USER#user-001 / CHATROOM#room-abc    ← ③のレコード
USER#user-001 / PROFILE              ← ユーザープロフィール
```

`begins_with(SK, "CONNECTION#")` でコネクションだけ、`begins_with(SK, "CHATROOM#")` でチャットルームだけをフィルタできる。これがSingle Table Designの核心 — **PKで「誰の」、SKで「何の」データかを表現する**。

**アクセスパターン #5**: `PK = USER#user-001 AND begins_with(SK, "CHATROOM#")` で Query → 参加ルーム一覧。

### ④ チャットルーム — `CHATROOM#{chatRoomId} / METADATA`

ルーム自体の情報。参加者一覧、ルーム種別（direct/group）、紐づくアクティビティIDを保持する。

```typescript
{
  PK: `CHATROOM#${chatRoomId}`,
  SK: 'METADATA',
  Type: 'ChatRoom',
  chatRoomId,
  name: 'ゴルフ部 週末ラウンド',
  participantIds: ['user-001', 'user-002', 'user-003'],
  type: 'group',        // 'direct' (1対1) or 'group'
  activityId: 'act-xyz', // アクティビティと紐づく場合
  lastMessageAt: now,
  createdAt: now,
}
```

**アクセスパターン #3**: `PK = CHATROOM#room-xyz AND SK = METADATA` で Get → ルーム情報。

### ⑤ メッセージ — `CHATROOM#{chatRoomId} / MESSAGE#{timestamp}#{messageId}`

メッセージはチャットルームのPK配下にソートキーとして格納する。**タイムスタンプをSKに含める** ことで、自動的に時系列順にソートされる。

```typescript
{
  PK: `CHATROOM#${chatRoomId}`,
  SK: `MESSAGE#${timestamp}#${messageId}`,
  Type: 'Message',
  messageId,
  chatRoomId,
  senderId,
  content: 'おはようございます！',
  messageType: 'user',
  readBy: [senderId],
  createdAt: now,
  timestamp,
}
```

**なぜSKが `MESSAGE#timestamp#messageId` なのか**:

- `timestamp` を先頭にすることで、時系列ソートがDynamoDBのネイティブ機能で実現される（`ScanIndexForward: false` で新しい順）
- 同一ミリ秒に複数メッセージが来た場合の衝突を `messageId`（UUID）で回避

```
CHATROOM#room-xyz / MESSAGE#1709234567000#msg-aaa  ← 古い
CHATROOM#room-xyz / MESSAGE#1709234890000#msg-bbb
CHATROOM#room-xyz / MESSAGE#1709235100000#msg-ccc  ← 新しい
```

**アクセスパターン #4**: `PK = CHATROOM#room-xyz AND begins_with(SK, "MESSAGE#")` で Query（`Limit: 50`, `ScanIndexForward: false`）→ 最新50件のメッセージを取得。

### ⑥ 最新メッセージキャッシュ — `CHATROOM#{chatRoomId} / LASTMESSAGE`

チャット一覧画面で「最後のメッセージ」をプレビュー表示するためのキャッシュレコード。

```typescript
{
  PK: `CHATROOM#${chatRoomId}`,
  SK: 'LASTMESSAGE',
  lastMessageAt: now,
  lastMessage: content.substring(0, 100), // 先頭100文字
}
```

**なぜ別レコードにするのか**: チャット一覧画面では「各ルームの最新メッセージ」だけが必要。もしMESSAGEレコードから毎回取得すると、ルーム数 × Query になり非効率。LASTMESSAGEレコードを用意しておけば、`BatchGetItem` で一括取得できる。

```
一覧取得のフロー:

1. PK = USER#user-001, begins_with(SK, "CHATROOM#") → ルームID一覧
2. BatchGetItem で各ルームの METADATA と LASTMESSAGE を一括取得
   = 2回のリクエストで全データが揃う
```

**アクセスパターン #6**: `PK = CHATROOM#room-xyz AND SK = LASTMESSAGE` で Get → 最新メッセージ。

## GSI（Global Secondary Index）の使いどころ

チャット参加記録（③）に `GSI1PK` / `GSI1SK` を設定している:

```typescript
{
  PK: `USER#${participantId}`,
  SK: `CHATROOM#${chatRoomId}`,
  GSI1PK: `USERROOMS#${participantId}`,  // GSI用
  GSI1SK: now,                            // 参加日時でソート
  ...
}
```

**GSIを使う場面**: メインテーブルのPK/SKだけではカバーできないアクセスパターンがあるとき。例えば「参加日時順でルームを取得したい」場合、メインのSKは `CHATROOM#room-xyz` というID形式なのでソートが効かない。GSI1SKに日時を入れることで、GSI1を使って時系列ソートが可能になる。

```
メインテーブル:                          GSI1:
PK              SK                       GSI1PK              GSI1SK
USER#user-001   CHATROOM#room-abc        USERROOMS#user-001  2026-02-01T...
USER#user-001   CHATROOM#room-xyz        USERROOMS#user-001  2026-02-15T...
                ↑ ルームID順             　                    ↑ 参加日時順
```

### GSIを作りすぎない

GSIはテーブルごとに最大20個まで。追加するたびにストレージとWCUのコストが増える。判断基準:

- **メインテーブルのPK/SKで対応できないか** をまず検討
- **Scan + FilterExpression で代用できないか**（データ量が少ない場合）
- 本当に必要なら GSI を追加

## CDKでのテーブル定義

ここまで設計したテーブルをCDKで定義するとこうなる:

```typescript
// database-stack.ts
this.table = new dynamodb.Table(this, 'Connect40Table', {
  tableName: `Connect40-Table-${props.envName}`,
  partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
  sortKey:      { name: 'SK', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // オンデマンド
  timeToLiveAttribute: 'ttl', // TTL有効化
});

// GSI1: ユーザーのルーム一覧（参加日時順）
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
  sortKey:      { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
});
```

**`PAY_PER_REQUEST`（オンデマンド）を選ぶ理由**: チャットのトラフィックはスパイクが激しい（昼休みに急増、深夜は0）。プロビジョンドキャパシティだとキャパシティの見積もりと調整が必要だが、オンデマンドなら使った分だけ課金。

## まとめ

| 設計ポイント | 判断 |
|-------------|------|
| テーブル設計 | Single Table Design（1テーブルに全エンティティ） |
| PK設計 | `エンティティ種別#ID` 形式（`USER#xxx`, `CHATROOM#xxx`, `CONNECTION#xxx`） |
| SK設計 | `METADATA` / `CONNECTION#xxx` / `CHATROOM#xxx` / `MESSAGE#timestamp#id` |
| 逆引き | コネクション: 双方向レコード（CONNECTION→USER, USER→CONNECTION） |
| 時系列 | メッセージのSKにタイムスタンプを含めてネイティブソート |
| キャッシュ | LASTMESSAGE レコードで一覧画面を高速化 |
| TTL | コネクションレコードに24h TTLでゴミ掃除 |
| GSI | 参加日時ソートなど、メインキーでカバーできないパターンに限定使用 |

**STDの鉄則: アクセスパターンから設計を逆算する**。「どんなQueryを投げたいか」をまず列挙し、それを最少のリクエスト数で実現できるPK/SKを設計する。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> DynamoDB Single Table Designでチャットアプリのデータを管理したい。
>
> テーブル構造:
> - PK/SKの汎用キー設計（`PK: string`, `SK: string`）
> - オンデマンドキャパシティ（PAY_PER_REQUEST）
> - TTL属性: `ttl`
> - GSI1: `GSI1PK` / `GSI1SK`
>
> エンティティ（PK / SK の形式）:
> 1. `CONNECTION#{connectionId}` / `METADATA` — WebSocket接続管理、TTL 24h
> 2. `USER#{userId}` / `CONNECTION#{connectionId}` — ユーザー→接続の逆引き、TTL 24h
> 3. `USER#{userId}` / `CHATROOM#{chatRoomId}` — チャット参加記録、GSI1PK=`USERROOMS#{userId}`
> 4. `CHATROOM#{chatRoomId}` / `METADATA` — ルーム情報、participantIds配列
> 5. `CHATROOM#{chatRoomId}` / `MESSAGE#{timestamp}#{messageId}` — メッセージ、時系列ソート
> 6. `CHATROOM#{chatRoomId}` / `LASTMESSAGE` — 最新メッセージキャッシュ
>
> CDKでテーブルとGSIを定義してほしい。

### エージェントに指示するときの注意点

- 「DynamoDBでチャットを作って」だけだとMulti Table Designで設計されがち。**Single Table Design** であることとPK/SKのフォーマットを明示する
- `ConnectionId → UserId` と `UserId → ConnectionId` の**双方向レコード**が必要な理由を伝えないと、片方だけ作って終わる
- メッセージのSKに `timestamp` + `messageId` を入れる理由（時系列ソート + 衝突回避）を明記しないと、`MESSAGE#{messageId}` だけの設計になりソートが効かない
- LASTMESSAGE キャッシュレコードの存在理由（一覧画面のN+1回避）を説明しないと省略される

---

次回: [第3回: CDKでWebSocket APIを構築する](/posts/aws-serverless-chat-part3) では、ここまで設計したテーブルとWebSocket APIのインフラをCDKで定義する方法を解説します。
