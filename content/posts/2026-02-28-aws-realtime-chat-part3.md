---
title: "API Gateway WebSocket + DynamoDB でリアルタイムチャットを作る（第3回：チャットルーム・既読管理編）"
emoji: "💬"
type: "tech"
topics: ["AWS", "Lambda", "DynamoDB", "TypeScript", "Chat"]
published: true
category: "HowTo"
date: "2026-02-28"
description: "チャットルームの作成・参加者管理、アクティビティ参加時の自動作成、readBy配列による既読・未読管理、未読カウントの算出まで、DynamoDB Single Table Designで実装する方法を解説します。"
series: "AWS リアルタイムチャット構築"
seriesOrder: 3
coverImage: "/images/posts/aws-realtime-chat-part3-cover.jpg"
---

> **このシリーズ: 全4回**
> 1. [第1回: インフラ設計編](/posts/aws-realtime-chat-part1)
> 2. [第2回: 接続管理・メッセージ配信編](/posts/aws-realtime-chat-part2)
> 3. [第3回: チャットルーム・既読管理編](/posts/aws-realtime-chat-part3) ← 今ここ
> 4. 第4回: React フロントエンド編

## 概要

[第2回](/posts/aws-realtime-chat-part2)では WebSocket の接続管理とメッセージ配信の Lambda を実装しました。

第3回では、チャットの「場」であるチャットルームと、メッセージの既読・未読管理を実装します：

- **チャットルームの作成**: direct（1対1）と group（複数人）の使い分け
- **アクティビティ参加時の自動作成**: イベントに参加したらグループチャットが自動で生まれる仕組み
- **ルーム一覧の取得**: BatchGetCommand による効率的なデータ取得
- **既読・未読管理**: `readBy` 配列を使った既読状態の追跡と未読カウントの算出

## チャットルームの作成

### direct と group の使い分け

```typescript
const type = participantIds.length === 2 ? 'direct' : 'group';
```

| タイプ | 参加者数 | 用途 |
|--------|---------|------|
| `direct` | 2人 | 1対1のダイレクトメッセージ |
| `group` | 3人以上 | グループチャット（アクティビティ等） |

タイプの判定は参加者数だけで行います。特別なフラグは不要です。

### 実装

```typescript
// backend/functions/chat/createRoom.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ddbDocClient } from '../../layers/common/nodejs/dynamodb';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  const { participantIds, activityId, name } = JSON.parse(event.body || '{}');

  // バリデーション
  if (!participantIds?.length) {
    return errorResponse(400, 'Participant IDs required');
  }
  if (participantIds.length > 50) {
    return errorResponse(400, 'Maximum 50 participants');
  }

  // リクエスト者自身を参加者に含める
  if (!participantIds.includes(userId)) {
    participantIds.push(userId);
  }

  const chatRoomId = uuidv4();
  const now = new Date().toISOString();
  const type = participantIds.length === 2 ? 'direct' : 'group';

  // チャットルーム METADATA を保存
  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CHATROOM#${chatRoomId}`,
        SK: 'METADATA',
        Type: 'ChatRoom',
        chatRoomId,
        name,
        participantIds,
        type,
        activityId,
        lastMessageAt: now,
        createdAt: now,
      },
    })
  );

  // 各参加者の ChatParticipation レコードを作成
  for (const participantId of participantIds) {
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${participantId}`,
          SK: `CHATROOM#${chatRoomId}`,
          GSI1PK: `USERROOMS#${participantId}`,
          GSI1SK: now,
          Type: 'ChatParticipation',
          chatRoomId,
          participantId,
          joinedAt: now,
        },
      })
    );
  }

  return successResponse({ chatRoomId, type, participantIds });
};
```

### DynamoDB に書き込まれるレコード

ルーム作成時に複数のレコードが書き込まれます。3人のグループチャットを例にすると：

```
┌─ CHATROOM レコード ─────────────────────────────────┐
│ PK: CHATROOM#room-1    SK: METADATA                 │
│ participantIds: [user-A, user-B, user-C]            │
│ type: "group"                                       │
│ name: "週末ゴルフ"                                  │
└─────────────────────────────────────────────────────┘

┌─ ChatParticipation レコード（参加者ごとに1つ）──────┐
│ PK: USER#user-A    SK: CHATROOM#room-1              │
│ GSI1PK: USERROOMS#user-A    GSI1SK: 2026-02-28T...  │
│                                                      │
│ PK: USER#user-B    SK: CHATROOM#room-1              │
│ GSI1PK: USERROOMS#user-B    GSI1SK: 2026-02-28T...  │
│                                                      │
│ PK: USER#user-C    SK: CHATROOM#room-1              │
│ GSI1PK: USERROOMS#user-C    GSI1SK: 2026-02-28T...  │
└──────────────────────────────────────────────────────┘
```

ChatParticipation レコードがあることで、**ユーザーが参加している全ルームを1回のクエリで取得**できます：

```typescript
// user-A の参加ルーム一覧
PK = USER#user-A AND begins_with(SK, 'CHATROOM#')
```

## アクティビティ参加時のチャットルーム自動作成

「イベントに参加したら、参加者同士でチャットできるようにしたい」という要件を、アクティビティの `join` Lambda 内で実現します。

### フロー

```
ユーザーが「参加」ボタンを押す
  │
  ├─ アクティビティに参加者追加
  │
  ├─ このアクティビティにチャットルームはある？
  │     │
  │     ├─ ない → チャットルームを新規作成
  │     │          ホスト + 参加者で group ルーム
  │     │          「グループチャットが作成されました」
  │     │          「○○さんが参加しました」
  │     │
  │     └─ ある → 既存ルームに参加者を追加
  │                participantIds に userId を追加
  │                「○○さんが参加しました」
  │
  └─ 完了
```

### 実装のポイント

```typescript
// backend/functions/activities/join.ts（チャット統合部分）

// アクティビティ → チャットルームの紐付けを検索
const chatRoomQuery = await ddbDocClient.send(
  new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `ACTIVITY#${activityId}`,
      ':sk': 'CHATROOM#',
    },
  })
);
```

アクティビティとチャットルームの紐付けには **ACTIVITY#{id} / CHATROOM#{id}** というレコードを使います：

```
PK: ACTIVITY#act-1    SK: CHATROOM#room-1
Type: ActivityChatRoom
```

これにより、1つのアクティビティに紐づくチャットルームを `begins_with` で検索できます。

### 既存ルームへの参加者追加

チャットルームが既に存在する場合は `UpdateCommand` で参加者を追加します：

```typescript
// participantIds 配列に新ユーザーを追加
await ddbDocClient.send(
  new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: `CHATROOM#${chatRoomId}`,
      SK: 'METADATA',
    },
    UpdateExpression:
      'SET participantIds = list_append(participantIds, :userId)',
    ExpressionAttributeValues: {
      ':userId': [userId],  // 配列として渡す
    },
  })
);
```

`list_append` は DynamoDB の組み込み関数で、既存の配列に要素を追加します。`:userId` は `[userId]` と配列で渡す必要がある点に注意してください。

### システムメッセージ

参加者の追加をチャット画面に通知するため、システムメッセージを投稿します：

```typescript
const createSystemMessage = async (
  chatRoomId: string,
  content: string
): Promise<void> => {
  const messageId = uuidv4();
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
        senderId: 'system',        // ← ユーザーIDではなく 'system'
        content,
        messageType: 'system',     // ← 'user' ではなく 'system'
        readBy: [],
        createdAt: now,
        timestamp,
      },
    })
  );

  // LASTMESSAGE も更新
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
};

// 使用例
await createSystemMessage(chatRoomId, `${nickname}さんが参加しました`);
```

`senderId: 'system'` と `messageType: 'system'` により、フロントエンドでユーザーメッセージとは異なるスタイルで表示できます（第4回で解説）。

## チャットルーム一覧の取得

ユーザーのチャットルーム一覧は、以下の2ステップで取得します：

```
Step 1: ChatParticipation レコードを Query で取得
  → ユーザーが参加しているルームIDの一覧

Step 2: BatchGetCommand でルーム詳細を一括取得
  → METADATA + LASTMESSAGE を同時に取得
```

### 実装

```typescript
// backend/functions/chat/getRooms.ts
export const handler = async (event) => {
  const userId = event.requestContext.authorizer?.claims?.sub;

  // Step 1: 参加ルームIDを取得
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'CHATROOM#',
      },
    })
  );
  const participations = result.Items || [];

  if (participations.length === 0) {
    return successResponse({ rooms: [], count: 0 });
  }

  // Step 2: METADATA と LASTMESSAGE を一括取得
  const batchKeys = participations.flatMap((p) => [
    { PK: `CHATROOM#${p.chatRoomId}`, SK: 'METADATA' },
    { PK: `CHATROOM#${p.chatRoomId}`, SK: 'LASTMESSAGE' },
  ]);

  // BatchGetItem は1回100件まで
  const allItems = [];
  for (let i = 0; i < batchKeys.length; i += 100) {
    const chunk = batchKeys.slice(i, i + 100);
    const batchResult = await ddbDocClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: { Keys: chunk },
        },
      })
    );
    if (batchResult.Responses?.[TABLE_NAME]) {
      allItems.push(...batchResult.Responses[TABLE_NAME]);
    }
  }

  // Map でインデックス化して O(1) ルックアップ
  const itemMap = new Map();
  for (const item of allItems) {
    itemMap.set(`${item.PK}#${item.SK}`, item);
  }

  // ルーム情報を組み立て
  const rooms = participations
    .map((p) => {
      const roomId = p.chatRoomId;
      const meta = itemMap.get(`CHATROOM#${roomId}#METADATA`);
      const last = itemMap.get(`CHATROOM#${roomId}#LASTMESSAGE`);
      if (!meta) return null;
      return {
        chatRoomId: meta.chatRoomId,
        name: meta.name || (meta.type === 'direct' ? 'ダイレクトメッセージ' : 'グループチャット'),
        participantIds: meta.participantIds,
        type: meta.type,
        lastMessageAt: last?.lastMessageAt || meta.createdAt,
        lastMessage: last?.lastMessage,
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );

  return successResponse({ rooms, count: rooms.length });
};
```

### なぜ BatchGetCommand を使うのか

10個のルームがある場合の比較：

```
❌ ルームごとに GetCommand × 10 + GetCommand(LASTMESSAGE) × 10 = 20回のAPI呼び出し

✅ BatchGetCommand × 1回 = 1回のAPI呼び出しで20レコード取得
```

`BatchGetCommand` は最大100キーを1回のリクエストで取得できます。ルーム数が50を超える場合は100件ずつチャンクに分割します。

### ルーム名のフォールバック

```typescript
name: meta.name || (meta.type === 'direct' ? 'ダイレクトメッセージ' : 'グループチャット')
```

ルーム作成時に `name` が未指定の場合、タイプに応じたデフォルト名を表示します。

## チャットルーム詳細とメッセージ取得

個別のチャットルームを開いたときは、メタデータと最新50件のメッセージを返します。

```typescript
// backend/functions/chat/getRoom.ts
export const handler = async (event) => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  const chatRoomId = event.pathParameters?.chatRoomId;

  // ルームメタデータを取得
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
  const chatRoom = roomResult.Items?.[0];

  // 参加者チェック
  if (!chatRoom?.participantIds?.includes(userId)) {
    return errorResponse(403, 'Not a participant');
  }

  // 最新50件のメッセージ（新しい順で取得 → 古い順に並べ替え）
  const messagesResult = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `CHATROOM#${chatRoomId}`,
        ':sk': 'MESSAGE#',
      },
      ScanIndexForward: false,  // 新しい順
      Limit: 50,
    })
  );

  const messages = (messagesResult.Items || [])
    .map((item) => ({
      messageId: item.messageId,
      senderId: item.senderId,
      content: item.content,
      messageType: item.messageType || 'user',
      readBy: item.readBy || [],
      createdAt: item.createdAt,
      timestamp: item.timestamp,
    }))
    .reverse();  // 古い順に並べ替えて返す

  return successResponse({
    chatRoomId: chatRoom.chatRoomId,
    name: chatRoom.name,
    participantIds: chatRoom.participantIds,
    type: chatRoom.type,
    messages,
  });
};
```

### ScanIndexForward と reverse の組み合わせ

```
DynamoDB側: ScanIndexForward: false → 新しい順で Limit: 50 を取得
  MESSAGE#1709136005000  ← 最新
  MESSAGE#1709136004000
  ...
  MESSAGE#1709136001000  ← 50件目

アプリ側: .reverse() → 古い順に並べ替え
  MESSAGE#1709136001000  ← 画面上部
  ...
  MESSAGE#1709136005000  ← 画面下部（最新）
```

「最新50件」を取得するには `ScanIndexForward: false` が必要ですが、チャット画面では古いメッセージが上、新しいメッセージが下に表示されるため、最終的に `.reverse()` で並べ替えます。

## 既読・未読管理

### 設計方針

各メッセージに `readBy` 配列を持たせ、既読にしたユーザーの ID を追加していく方式です。

```json
{
  "messageId": "msg-123",
  "senderId": "user-A",
  "content": "明日の予定どうする？",
  "readBy": ["user-A", "user-B"]
}
```

### 既読の判定ロジック

```
送信者自身:
  readBy には送信時に自動追加 → 常に既読

受信者の未読判定:
  readBy に自分の userId が含まれていない → 未読

DM での「既読」表示:
  readBy.length > 1 → 相手が読んだ
```

### メッセージ送信時の readBy 初期化

第2回で実装した sendMessage Lambda で、送信者を自動的に既読にしています：

```typescript
// sendMessage.ts（再掲）
await ddbDocClient.send(
  new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CHATROOM#${chatRoomId}`,
      SK: `MESSAGE#${timestamp}#${messageId}`,
      // ...
      readBy: [senderId],  // 送信者は自動既読
    },
  })
);
```

### フロントエンドでの既読更新

Zustand ストアの `markAsRead` で、ローカルのメッセージ状態を更新します：

```typescript
// frontend/src/stores/chat.ts
markAsRead: (messageId, userId) =>
  set((state) => ({
    messages: state.messages.map((msg) =>
      msg.messageId === messageId
        ? { ...msg, readBy: [...new Set([...msg.readBy, userId])] }
        : msg
    ),
  })),
```

`new Set` で重複を防ぎつつ、`readBy` 配列に userId を追加します。

### 未読カウントの算出

ルーム一覧で表示する未読バッジのカウントは、以下のロジックで算出します：

```typescript
// ルーム内の全メッセージのうち、readBy に自分が含まれていないものを数える
const unreadCount = messages.filter(
  (msg) => !msg.readBy.includes(currentUserId)
).length;
```

Zustand ストアには `updateUnreadCount` アクションがあり、ルーム一覧の未読バッジを更新できます：

```typescript
updateUnreadCount: (chatRoomId, count) =>
  set((state) => ({
    rooms: state.rooms.map((room) =>
      room.chatRoomId === chatRoomId
        ? { ...room, unreadCount: count }
        : room
    ),
  })),
```

### DM の既読表示

ダイレクトメッセージ（2人のチャット）では、メッセージバブルに既読状態を表示します：

```typescript
// 自分が送ったメッセージで、相手が読んだかどうか
const isRead = message.readBy.length > 1;
// readBy.length === 1 → 送信者自身のみ（未読）
// readBy.length > 1   → 送信者 + 受信者（既読）
```

グループチャットでは `readBy.length > 1` だと「誰か1人でも読んだ」という意味になります。全員が読んだかどうかは `readBy.length === participantIds.length` で判定できます。

## ポイント・注意点

### 参加者上限

```typescript
if (participantIds.length > 50) {
  return errorResponse(400, 'Maximum 50 participants');
}
```

DynamoDB のアイテムサイズ上限は 400KB です。participantIds が増えすぎるとこの上限に近づくため、適切な制限を設けます。

### ルーム作成のレート制限

フリープランのユーザーには作成可能なチャットルーム数に上限を設けます：

```typescript
const usageCheck = await checkChatRoomLimit(ddbDocClient, TABLE_NAME, userId, subscriptionPlan);
if (!usageCheck.allowed) {
  return errorResponse(403, `ルーム上限: ${usageCheck.current}/${usageCheck.limit}`);
}
```

`checkChatRoomLimit` は ChatParticipation レコードの数をカウントして判定します。

### 管理者のバイパス

```typescript
function isAdmin(claims: Record<string, string>): boolean {
  const groups = claims['cognito:groups'];
  const groupList = Array.isArray(groups) ? groups : groups.split(',').map((g) => g.trim());
  return groupList.includes('admin');
}
```

Cognito のグループに `admin` が含まれるユーザーは、参加者でなくてもルーム情報を閲覧できます。サポート対応やモデレーション用です。

## まとめ

第3回では、チャットルームと既読管理を実装しました：

- **チャットルーム作成** は参加者数で `direct` / `group` を自動判定し、METADATA + ChatParticipation レコードを書き込む
- **アクティビティ参加時** にチャットルームを自動作成・参加者追加し、システムメッセージを投稿
- **ルーム一覧取得** は ChatParticipation → BatchGetCommand の2ステップで効率的に取得
- **既読管理** は `readBy` 配列にユーザーIDを追加する方式。DM では `readBy.length > 1` で既読表示

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> DynamoDB Single Table Design でチャットルームと既読管理を実装してください。
>
> 技術スタック: Node.js 20.x Lambda、TypeScript、@aws-sdk/lib-dynamodb
>
> チャットルーム作成 (POST /chat/rooms):
> - 入力: participantIds (string[]), activityId? (string), name? (string)
> - リクエスト者が participantIds に含まれていなければ自動追加
> - 参加者2人なら type: "direct"、3人以上なら type: "group"
> - 上限50人
> - CHATROOM#{roomId}#METADATA と、参加者ごとに USER#{userId}#CHATROOM#{roomId} を書き込む
> - ChatParticipation レコードには GSI1PK: USERROOMS#{userId}, GSI1SK: タイムスタンプ を付与
>
> アクティビティ参加時 (POST /activities/:id/join):
> - ACTIVITY#{id}#CHATROOM# を begins_with で検索してルームの存在を確認
> - ルームがなければ新規作成（ホスト + 参加者）、ACTIVITY#{id}#CHATROOM#{roomId} の紐付けレコードも作成
> - ルームがあれば UpdateCommand の list_append で participantIds に追加
> - システムメッセージ（senderId: 'system', messageType: 'system'）を投稿
>
> ルーム一覧 (GET /chat/rooms):
> - USER#{userId} SK begins_with CHATROOM# で ChatParticipation を取得
> - BatchGetCommand で METADATA + LASTMESSAGE を一括取得（100件ずつチャンク）
> - lastMessageAt の降順でソート
>
> 既読管理:
> - メッセージ送信時に readBy: [senderId] を初期値にセット
> - 既読にするときは readBy 配列に userId を追加（Set で重複防止）
> - 未読判定: readBy に自分の userId が含まれていない
> - DM 既読表示: readBy.length > 1

---

次回: [第4回: React フロントエンド編](/posts/aws-realtime-chat-part4) では、WebSocketService の再接続ロジック、Zustand ストア、チャットUIコンポーネントを実装して完成させます。
