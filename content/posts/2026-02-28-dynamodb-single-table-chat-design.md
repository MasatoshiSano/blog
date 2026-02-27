---
title: "DynamoDB Single-Table Design でチャットのコネクション・メッセージ・ルームを管理する"
emoji: "🗄️"
type: "tech"
topics: ["DynamoDB", "AWS", "NoSQL", "設計パターン", "チャット"]
published: true
category: "Architecture"
date: "2026-02-28"
description: "リアルタイムチャットに必要な接続管理、メッセージ保存、ルーム管理をDynamoDB単一テーブルのPK/SKパターンで実現する設計と、そのクエリパターンを解説する。"
---

## 概要

リアルタイムチャットシステムでは、WebSocket接続の管理、メッセージの永続化、チャットルームの管理、ユーザーの参加状態の追跡など、複数の異なるエンティティを扱う必要がある。これらを DynamoDB の Single-Table Design で1つのテーブルに収める設計パターンを解説する。

RDB的な発想で「connectionsテーブル」「messagesテーブル」「roomsテーブル」と分けるとJOINが使えないDynamoDBでは非効率になる。代わりに、PK（Partition Key）とSK（Sort Key）のパターンで複数エンティティを同一テーブルに格納し、アクセスパターンに最適化する。

## 前提条件

- DynamoDB テーブル（PK: String, SK: String）
- GSI1（GSI1PK: String, GSI1SK: String）- オプション
- TTL属性: `ttl`
- API Gateway WebSocket + Lambda によるリアルタイムチャット

## エンティティとキー設計

### 一覧

| エンティティ | PK | SK | 用途 |
|---|---|---|---|
| 接続メタデータ | `CONNECTION#{connectionId}` | `METADATA` | 接続ID→ユーザーの逆引き |
| ユーザー接続 | `USER#{userId}` | `CONNECTION#{connectionId}` | ユーザー→全接続の正引き |
| チャットルーム | `CHATROOM#{chatRoomId}` | `METADATA` | ルーム定義と参加者一覧 |
| メッセージ | `CHATROOM#{chatRoomId}` | `MESSAGE#{timestamp}#{messageId}` | 時系列ソートされたメッセージ |
| 最終メッセージ | `CHATROOM#{chatRoomId}` | `LASTMESSAGE` | ルーム一覧のプレビュー用 |
| チャット参加 | `USER#{userId}` | `CHATROOM#{chatRoomId}` | ユーザーの参加ルーム一覧 |
| ユーザープロフィール | `USER#{userId}` | `PROFILE` | 本人確認ステータス等 |

### テーブル全体像

```
┌──────────────────────────────┬──────────────────────────────┬────────────────┐
│ PK                           │ SK                           │ 主な属性        │
├──────────────────────────────┼──────────────────────────────┼────────────────┤
│ CONNECTION#abc123             │ METADATA                     │ userId, ttl    │
│ USER#user-1                  │ CONNECTION#abc123             │ connectionId   │
│ USER#user-1                  │ CONNECTION#def456             │ connectionId   │
│ USER#user-1                  │ PROFILE                      │ nickname, ...  │
│ USER#user-1                  │ CHATROOM#room-1              │ joinedAt       │
│ USER#user-1                  │ CHATROOM#room-2              │ joinedAt       │
│ CHATROOM#room-1              │ METADATA                     │ participantIds │
│ CHATROOM#room-1              │ LASTMESSAGE                  │ lastMessage    │
│ CHATROOM#room-1              │ MESSAGE#1709136000000#uuid-1 │ content        │
│ CHATROOM#room-1              │ MESSAGE#1709136001000#uuid-2 │ content        │
└──────────────────────────────┴──────────────────────────────┴────────────────┘
```

## 各エンティティの設計理由

### 1. 接続の双方向マッピング

WebSocket接続を管理するために、2つのレコードを保存する。

```typescript
// レコード1: 接続ID → ユーザー（逆引き）
{
  PK: 'CONNECTION#abc123',
  SK: 'METADATA',
  userId: 'user-1',
  connectionId: 'abc123',
  connectedAt: '2026-02-28T10:00:00Z',
  ttl: 1709222400, // 24時間後のUnixタイムスタンプ
}

// レコード2: ユーザー → 接続ID（正引き）
{
  PK: 'USER#user-1',
  SK: 'CONNECTION#abc123',
  connectionId: 'abc123',
  connectedAt: '2026-02-28T10:00:00Z',
  ttl: 1709222400,
}
```

**なぜ双方向か？**

| 場面 | 必要なクエリ | 使うレコード |
|------|-------------|-------------|
| sendMessage: 送信者特定 | 接続ID → ユーザーID | `CONNECTION#→METADATA` |
| sendMessage: 配信先取得 | ユーザーID → 全接続 | `USER#→CONNECTION#*` |
| $disconnect: ユーザー特定 | 接続ID → ユーザーID | `CONNECTION#→METADATA` |

`CONNECTION#→METADATA` だけだと、あるユーザーの全接続を取得するためにScanが必要になる。`USER#→CONNECTION#` を追加することで、`begins_with(SK, 'CONNECTION#')` のQuery一発で取得できる。

```typescript
// ユーザーの全接続を取得
const result = await ddbDocClient.send(new QueryCommand({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
  ExpressionAttributeValues: {
    ':pk': `USER#${participantId}`,
    ':sk': 'CONNECTION#',
  },
}));
```

### 2. メッセージのソートキー設計

```
SK: MESSAGE#{timestamp}#{messageId}
```

例: `MESSAGE#1709136000000#550e8400-e29b-41d4-a716-446655440000`

**タイムスタンプを先頭にする理由:**
- DynamoDBはSKで辞書順ソートされる
- タイムスタンプ（ミリ秒エポック）を先頭にすることで、時系列順が保証される
- `ScanIndexForward: false` で「新しい順」、`true` で「古い順」に取得可能

**messageIdを末尾に付ける理由:**
- 同一ミリ秒に複数メッセージが来た場合のSK衝突を防ぐ
- UUIDで一意性を保証

```typescript
// 最新50件を取得
const messages = await ddbDocClient.send(new QueryCommand({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
  ExpressionAttributeValues: {
    ':pk': `CHATROOM#${chatRoomId}`,
    ':sk': 'MESSAGE#',
  },
  ScanIndexForward: false, // 新しい順
  Limit: 50,
}));

// 表示時にはreverseして古い順に並べる
const displayMessages = messages.Items.reverse();
```

### 3. LASTMESSAGE の非正規化

```typescript
{
  PK: 'CHATROOM#room-1',
  SK: 'LASTMESSAGE',
  lastMessageAt: '2026-02-28T10:05:00Z',
  lastMessage: 'お疲れ様です！明日の予定を確認しましょう。',
}
```

**なぜ別レコードにするのか？**

チャットルーム一覧画面では「最後のメッセージ」と「最終更新日時」を表示する必要がある。毎回 `MESSAGE#` レコードをQueryして最新1件を取得するのは非効率。`LASTMESSAGE` レコードを用意すれば、`BatchGetItem` で複数ルームの最終メッセージを一括取得できる。

```typescript
// ルーム一覧取得: METADATAとLASTMESSAGEを一括取得
const batchKeys = participations.flatMap((p) => [
  { PK: `CHATROOM#${p.chatRoomId}`, SK: 'METADATA' },
  { PK: `CHATROOM#${p.chatRoomId}`, SK: 'LASTMESSAGE' },
]);

const result = await ddbDocClient.send(new BatchGetCommand({
  RequestItems: {
    [TABLE_NAME]: { Keys: batchKeys },
  },
}));
```

`BatchGetItem` は最大100キーまで一括取得可能。50ルームなら100キー（METADATA + LASTMESSAGE）でちょうど1リクエストに収まる。

### 4. チャット参加レコード

```typescript
{
  PK: 'USER#user-1',
  SK: 'CHATROOM#room-1',
  GSI1PK: 'USERROOMS#user-1',
  GSI1SK: '2026-02-28T10:00:00Z',
  chatRoomId: 'room-1',
  joinedAt: '2026-02-28T10:00:00Z',
}
```

**なぜ必要か？**

`CHATROOM#→METADATA` の `participantIds` 配列にユーザーIDは入っているが、「あるユーザーが参加している全ルーム」を取得するには全ルームをScanする必要がある。`USER#→CHATROOM#` レコードを追加すれば：

```typescript
// ユーザーの全参加ルームを取得
const rooms = await ddbDocClient.send(new QueryCommand({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
  ExpressionAttributeValues: {
    ':pk': `USER#${userId}`,
    ':sk': 'CHATROOM#',
  },
}));
```

## アクセスパターン一覧

| # | アクセスパターン | キー条件 | 操作 |
|---|---|---|---|
| 1 | 接続IDからユーザーを特定 | `PK=CONNECTION#X, SK=METADATA` | GetItem |
| 2 | ユーザーの全接続を取得 | `PK=USER#X, SK begins_with CONNECTION#` | Query |
| 3 | ユーザーの参加ルーム一覧 | `PK=USER#X, SK begins_with CHATROOM#` | Query |
| 4 | ルームのメタデータ取得 | `PK=CHATROOM#X, SK=METADATA` | GetItem |
| 5 | ルームのメッセージ取得 | `PK=CHATROOM#X, SK begins_with MESSAGE#` | Query |
| 6 | ルームの最終メッセージ | `PK=CHATROOM#X, SK=LASTMESSAGE` | GetItem |
| 7 | 複数ルームの情報一括取得 | 複数キーペア | BatchGetItem |
| 8 | ユーザープロフィール取得 | `PK=USER#X, SK=PROFILE` | GetItem |

## TTLによる自動クリーンアップ

接続レコード（`CONNECTION#` と `USER#→CONNECTION#`）にはTTLを設定する。

```typescript
ttl: Math.floor(Date.now() / 1000) + 86400 // 24時間後
```

- `$disconnect` イベントは必ず発火するとは限らない（ネットワーク断等）
- TTLが設定されていれば、DynamoDBが非同期でレコードを削除する
- 完全な即時削除ではない（最大48時間の遅延があり得る）が、セーフティネットとしては十分

**メッセージレコードにはTTLを設定しない**: チャット履歴は永続的に保持する。必要に応じてS3へのアーカイブを検討する。

## ポイント・注意点

### BatchGetItemの100キー制限

`BatchGetItem` は1回のリクエストで最大100キーまで。ルーム数が50を超える場合はチャンク分割が必要：

```typescript
for (let i = 0; i < batchKeys.length; i += 100) {
  const chunk = batchKeys.slice(i, i + 100);
  const result = await ddbDocClient.send(new BatchGetCommand({
    RequestItems: { [TABLE_NAME]: { Keys: chunk } },
  }));
  allItems.push(...result.Responses[TABLE_NAME]);
}
```

### 書き込みの整合性

`sendMessage` では3つのレコードを書き込む（メッセージ、LASTMESSAGE、ルーム一覧のソート情報）。DynamoDBにはトランザクションがあるが、チャットの場合は「メッセージが保存されたが LASTMESSAGE の更新が失敗した」程度の不整合は許容できるため、個別のPutCommandで十分。

### HOTパーティションの回避

人気のチャットルームに大量のメッセージが集中すると、`CHATROOM#{chatRoomId}` パーティションがホットスポットになる可能性がある。DynamoDBのアダプティブキャパシティが自動で対応するが、極端な場合（秒間数千メッセージ）はルームIDにシャーディングキーを追加する検討が必要。

## まとめ

| 設計判断 | 理由 |
|---------|------|
| 双方向接続マッピング | 接続ID→ユーザー と ユーザー→全接続 の両方向のクエリが必要 |
| `MESSAGE#{timestamp}#{messageId}` | 時系列ソート保証 + ミリ秒衝突回避 |
| `LASTMESSAGE` 非正規化 | ルーム一覧の高速表示（Queryではなく BatchGetItem で取得） |
| チャット参加レコード | ユーザーの参加ルーム一覧をScanなしで取得 |
| 24時間TTL | 切断イベント漏れ時のゾンビ接続自動クリーンアップ |

Single-Table Designは初見では複雑に見えるが、アクセスパターンを先に定義すれば合理的な設計に落ちる。RDBのようにテーブルを正規化するのではなく、「どうクエリするか」から逆算してキーを設計する。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> DynamoDB Single-Table Design でリアルタイムチャットのデータモデルを設計・実装してください。
>
> テーブル定義:
> - PK (String), SK (String), GSI1PK (String), GSI1SK (String), TTL属性: ttl
>
> 以下のエンティティとキーパターンを実装:
> 1. 接続メタデータ: PK=`CONNECTION#{connectionId}`, SK=`METADATA` → userId, ttl(24h)
> 2. ユーザー接続: PK=`USER#{userId}`, SK=`CONNECTION#{connectionId}` → connectionId, ttl(24h)
> 3. チャットルーム: PK=`CHATROOM#{chatRoomId}`, SK=`METADATA` → participantIds[], type, name
> 4. メッセージ: PK=`CHATROOM#${chatRoomId}`, SK=`MESSAGE#${timestamp}#${messageId}` → senderId, content, messageType
> 5. 最終メッセージ: PK=`CHATROOM#${chatRoomId}`, SK=`LASTMESSAGE` → lastMessageAt, lastMessage(100文字)
> 6. チャット参加: PK=`USER#${userId}`, SK=`CHATROOM#${chatRoomId}` → joinedAt, GSI1PK=`USERROOMS#${userId}`
>
> アクセスパターン実装:
> - ユーザーの全接続取得: `PK=USER#X, SK begins_with CONNECTION#`
> - ユーザーの参加ルーム一覧: `PK=USER#X, SK begins_with CHATROOM#` → BatchGetItemでMETADATA+LASTMESSAGEを一括取得（100キー上限でチャンク分割）
> - ルームのメッセージ取得: `PK=CHATROOM#X, SK begins_with MESSAGE#`, ScanIndexForward=false, Limit=50
>
> 注意点:
> - 接続レコードは双方向マッピング（逆引き+正引き）が必須
> - BatchGetItemの100キー制限に対応してチャンク分割する
> - メッセージSKはtimestamp先頭でソート保証、末尾UUIDで衝突回避
> - LASTMESSAGEの非正規化でルーム一覧の高速表示を実現する
