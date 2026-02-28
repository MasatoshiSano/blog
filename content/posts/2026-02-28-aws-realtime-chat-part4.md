---
title: "サーバーレスでリアルタイムチャットを構築する（第4回：Reactフロントエンド編）— WebSocket再接続・楽観的更新"
emoji: "🎨"
type: "tech"
topics: ["React", "WebSocket", "Zustand", "TypeScript", "Chat"]
published: true
category: "HowTo"
date: "2026-02-28"
description: "WebSocketService の再接続・ハートビート、Zustand による状態管理、楽観的更新と重複排除、メッセージバブル・未読バッジなどチャットUIコンポーネントを実装してシリーズを完結させます。"
series: "サーバーレスでリアルタイムチャット構築"
seriesOrder: 4
coverImage: "/images/posts/aws-realtime-chat-part4-cover.jpg"
---

> **このシリーズ: 全4回**
> 1. [第1回: インフラ設計編](/posts/aws-realtime-chat-part1)
> 2. [第2回: 接続管理・メッセージ配信編](/posts/aws-realtime-chat-part2)
> 3. [第3回: チャットルーム・既読管理編](/posts/aws-realtime-chat-part3)
> 4. [第4回: React フロントエンド編](/posts/aws-realtime-chat-part4) ← 今ここ

## 概要

[第3回](/posts/aws-realtime-chat-part3)までで、AWS 側のインフラと Lambda 関数はすべて揃いました。

最終回では、React フロントエンドを実装してチャット機能を完成させます：

- **WebSocketService**: 接続・再接続・ハートビート・メッセージ配信をカプセル化
- **Zustand Chat Store**: メッセージの重複排除と既読管理
- **楽観的更新**: 送信ボタンを押した瞬間にメッセージを表示
- **チャットUI**: ルーム一覧（未読バッジ）、メッセージバブル（既読表示）、入力フォーム

## こんな人向け

- WebSocket接続の再接続・ハートビートをReactで実装する方法を知りたい
- Zustandでチャットの状態管理（メッセージ重複排除・既読）を設計したい
- 楽観的更新でチャットUIの応答性を改善したい
- メッセージバブル・未読バッジなどチャットUIコンポーネントの実装例を探している

## WebSocketService

ブラウザの `WebSocket` API をラップし、再接続・ハートビート・メッセージ購読をカプセル化したサービスクラスです。

### 実装

```typescript
// frontend/src/services/websocket.ts
type MessageHandler = (data: Record<string, unknown>) => void;

export class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(
    private url: string,
    private getAccessToken: () => string | null
  ) {}

  connect(): Promise<void> {
    // 既存のゾンビ接続をクリア
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
      this.stopHeartbeat();
    }
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      const token = this.getAccessToken();
      if (!token) {
        reject(new Error('No access token'));
        return;
      }

      this.ws = new WebSocket(`${this.url}?token=${token}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.messageHandlers.forEach((handler) => handler(message));
      };

      this.ws.onerror = (error) => reject(error);

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (!this.intentionalClose) {
          this.attemptReconnect();
        }
      };
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.stopHeartbeat();
    this.messageHandlers.clear();
  }

  sendMessage(action: string, data: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify({ action, ...data }));
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ... (private methods below)
}
```

### 再接続: 指数バックオフ

ネットワーク断やサーバー側のタイムアウトで切断されたとき、自動的に再接続を試みます。

```typescript
private attemptReconnect(): void {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    console.error('Max reconnect attempts reached');
    return;
  }

  this.reconnectAttempts++;
  // 1秒 → 2秒 → 4秒 → 8秒 → 16秒
  const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

  this.reconnectTimer = setTimeout(() => {
    this.connect().catch(() => {});
  }, delay);
}
```

```
試行1: 1秒後
試行2: 2秒後
試行3: 4秒後
試行4: 8秒後
試行5: 16秒後（最大）
→ 全失敗: 諦める
```

指数バックオフにより、サーバーに過負荷をかけずに回復を待ちます。

### ハートビート: 接続維持

API Gateway WebSocket API は **10分間通信がないと接続を切断** します。30秒間隔で ping を送信して接続を維持します。

```typescript
private startHeartbeat(): void {
  this.heartbeatInterval = setInterval(() => {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'ping' }));
    }
  }, 30000);
}
```

`action: 'ping'` は API Gateway の `$default` ルートにルーティングされ、第2回で実装した Default Lambda が 200 を返します。

### intentionalClose フラグ

```typescript
disconnect(): void {
  this.intentionalClose = true;  // ← これがないと再接続が走る
  this.ws?.close();
}
```

ユーザーがページを離れたとき等、意図的な切断では再接続しないようにフラグで制御します。

### シングルトンパターン

アプリ全体で WebSocket 接続は1つだけ。シングルトンで管理します：

```typescript
let wsService: WebSocketService | null = null;

export function getWebSocketService(
  url?: string,
  getAccessToken?: () => string | null
): WebSocketService {
  if (!wsService && url && getAccessToken) {
    wsService = new WebSocketService(url, getAccessToken);
  }
  if (!wsService) throw new Error('WebSocketService not initialized');
  return wsService;
}

export function disconnectWebSocket(): void {
  wsService?.disconnect();
  wsService = null;
}
```

## Zustand Chat Store

チャットの状態管理に Zustand を使います。Redux に比べてボイラープレートが少なく、React の外からもアクセスできるのが利点です。

### Store 定義

```typescript
// frontend/src/stores/chat.ts
import { create } from 'zustand';

export interface Message {
  messageId: string;
  chatRoomId: string;
  senderId: string;
  content: string;
  messageType: 'user' | 'system';
  readBy: string[];
  createdAt: string;
  timestamp: number;
}

export interface ChatRoom {
  chatRoomId: string;
  name?: string;
  participantIds: string[];
  type: 'direct' | 'group';
  activityId?: string;
  lastMessageAt?: string;
  lastMessage?: string;
  createdAt: string;
  unreadCount?: number;
}

interface ChatState {
  rooms: ChatRoom[];
  currentRoom: ChatRoom | null;
  messages: Message[];
  isConnected: boolean;
  setRooms: (rooms: ChatRoom[]) => void;
  setCurrentRoom: (room: ChatRoom | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  removeMessage: (messageId: string) => void;
  setConnected: (connected: boolean) => void;
  markAsRead: (messageId: string, userId: string) => void;
  updateUnreadCount: (chatRoomId: string, count: number) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  rooms: [],
  currentRoom: null,
  messages: [],
  isConnected: false,
  // ... actions
}));
```

### 重複排除: addMessage

チャットでは「楽観的更新」と「WebSocket ブロードキャスト」の両方でメッセージが追加されるため、重複が発生します。

```
ユーザーが送信ボタンを押す
  ├─ ① 楽観的更新: addMessage(localMessage)     ← 即座に画面に表示
  └─ ② WebSocket経由: addMessage(serverMessage)  ← サーバーから戻ってくる
```

2つの判定で重複を防ぎます：

```typescript
addMessage: (message) =>
  set((state) => {
    const isDuplicate = state.messages.some(
      (m) =>
        // 完全一致: 同じ messageId
        m.messageId === message.messageId ||
        // 部分一致: 同じ送信者 + 同じ内容 + 5秒以内
        (m.senderId === message.senderId &&
          m.content === message.content &&
          Math.abs(m.timestamp - message.timestamp) < 5000)
    );
    if (isDuplicate) return state;
    return { messages: [...state.messages, message] };
  }),
```

なぜ部分一致も必要か？ 楽観的更新ではクライアント側で生成した仮の `messageId` を使いますが、サーバーからブロードキャストされるメッセージには別の `messageId` が付きます。内容とタイムスタンプで一致を判定することで、この不一致をカバーします。

### 既読管理: markAsRead

```typescript
markAsRead: (messageId, userId) =>
  set((state) => ({
    messages: state.messages.map((msg) =>
      msg.messageId === messageId
        ? { ...msg, readBy: [...new Set([...msg.readBy, userId])] }
        : msg
    ),
  })),
```

`new Set` でスプレッドすることで、既に含まれている userId を重複追加しません。

### 未読カウント: updateUnreadCount

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

ルーム一覧の未読バッジ表示に使います。

## 楽観的更新とロールバック

メッセージ送信時、WebSocket の応答を待たずに画面に表示する「楽観的更新」を実装します。

```typescript
const handleSendMessage = async (content: string) => {
  const wsService = getWebSocketService(WS_URL, () => idToken);

  // 接続チェック & 自動再接続
  if (!wsService.isConnected()) {
    await wsService.connect();
  }

  const messageId = crypto.randomUUID();  // 仮のID

  // ① 楽観的にメッセージを追加（即座に画面に表示）
  addMessage({
    messageId,
    chatRoomId: roomId,
    senderId: userId,
    content,
    messageType: 'user',
    readBy: [],
    createdAt: new Date().toISOString(),
    timestamp: Date.now(),
  });

  try {
    // ② WebSocket で送信
    wsService.sendMessage('sendMessage', {
      chatRoomId: roomId,
      content,
    });
  } catch {
    // ③ 失敗したら楽観的に追加したメッセージを削除（ロールバック）
    removeMessage(messageId);
    setSendError('メッセージの送信に失敗しました');
  }
};
```

```
成功パターン:
  ① 楽観的追加 → 画面に表示
  ② WebSocket送信 → 成功
  ③ サーバーからブロードキャスト → 重複排除で無視
  → ユーザーは遅延なくメッセージを見れる

失敗パターン:
  ① 楽観的追加 → 画面に表示
  ② WebSocket送信 → 失敗
  ③ removeMessage → 画面からメッセージを削除
  → ユーザーにエラーを通知
```

## タブ復帰時の再接続

ユーザーがブラウザタブを切り替えて戻ってきたとき、接続が切れている可能性があります。

```typescript
useEffect(() => {
  const handleVisibilityChange = async () => {
    if (document.hidden) {
      // タブが非表示になった時刻を記録
      hiddenAtRef.current = Date.now();
      return;
    }

    // タブが再表示された
    const hiddenMs = hiddenAtRef.current
      ? Date.now() - hiddenAtRef.current
      : 0;
    const wsService = getWebSocketService(WS_URL, () => idToken);

    // 30秒以上非表示だった or 接続が切れている → 再接続
    if (hiddenMs > 30000 || !wsService.isConnected()) {
      setIsReconnecting(true);
      try {
        await wsService.connect();
        setConnected(true);
      } catch (e) {
        console.error('Reconnect failed:', e);
      } finally {
        setIsReconnecting(false);
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () =>
    document.removeEventListener('visibilitychange', handleVisibilityChange);
}, [roomId, idToken]);
```

`document.hidden` と `visibilitychange` イベントで、タブの表示/非表示を検出します。30秒の閾値は、API Gateway の接続維持とハートビート間隔のバランスから決めています。

## MessageBubble: メッセージ表示コンポーネント

3種類のメッセージを表示します。

### 実装

```tsx
// frontend/src/components/chat/MessageBubble.tsx
import { memo } from 'react';
import { type Message } from '../../stores/chat';

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  senderNickname?: string;
  senderPhoto?: string;
}

export const MessageBubble = memo(
  ({ message, isMine, senderNickname, senderPhoto }: MessageBubbleProps) => {
    // --- システムメッセージ ---
    if (message.messageType === 'system') {
      return (
        <div className="flex justify-center mb-4">
          <span className="border-b text-xs py-2 px-4 text-muted">
            {message.content}
          </span>
        </div>
      );
    }

    const time = new Date(message.createdAt).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const isRead = message.readBy.length > 1;

    // --- 相手のメッセージ（左寄せ、アバター付き）---
    if (!isMine) {
      return (
        <div className="flex justify-start mb-4">
          <div className="flex items-end gap-2">
            <div className="w-8 h-8 rounded-full overflow-hidden">
              {senderPhoto ? (
                <img src={senderPhoto} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{senderNickname?.[0] ?? '?'}</span>
              )}
            </div>
            <div className="max-w-[70%]">
              <p className="text-xs text-muted mb-1">{senderNickname}</p>
              <div className="px-4 py-2 bg-surface border rounded">
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
              <span className="text-xs text-muted mt-1">{time}</span>
            </div>
          </div>
        </div>
      );
    }

    // --- 自分のメッセージ（右寄せ、既読表示付き）---
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[70%] flex flex-col items-end">
          <div className="px-4 py-2 bg-elevated rounded">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted">{time}</span>
            <span className="text-xs text-muted">
              {isRead ? '既読' : '未読'}
            </span>
          </div>
        </div>
      </div>
    );
  }
);
```

### 3種類のメッセージ表示

```
┌─────────────────────────────────────┐
│        ○○さんが参加しました          │  ← システムメッセージ（中央）
│     ─────────────────────           │
│                                      │
│  [avatar] 田中                       │
│  │ 明日の予定どうする？  │           │  ← 相手のメッセージ（左寄せ）
│  14:30                               │
│                                      │
│           │ 10時集合でいいよ │        │  ← 自分のメッセージ（右寄せ）
│                     14:31 既読       │
└──────────────────────────────────────┘
```

### memo で再レンダリングを防止

```typescript
export const MessageBubble = memo(({ message, isMine, ... }) => {
```

チャットでは新しいメッセージが追加されるたびに全体がレンダリングされます。`memo` でラップすることで、props が変わっていないメッセージバブルの再レンダリングをスキップします。

## MessageInput: メッセージ入力コンポーネント

### 機能

- テキスト入力（自動高さ調整）
- Enter で送信、Shift+Enter で改行
- 本人確認チェック（未承認なら入力不可）
- チャットクレジット残数表示

```tsx
// frontend/src/components/chat/MessageInput.tsx
export const MessageInput = ({ onSend, disabled, externalMessage }: MessageInputProps) => {
  const verificationStatus = useAuthStore((state) => state.verificationStatus);
  const chatCredits = useAuthStore((state) => state.chatCredits);
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // textarea の高さを内容に合わせて自動調整
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [message]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 本人未確認ならロック画面を表示
  if (verificationStatus !== 'approved') {
    return (
      <div className="p-4 border-t">
        <p>チャットを利用するには本人確認が必要です</p>
      </div>
    );
  }

  // クレジット切れ
  if (chatCredits !== null && chatCredits <= 0) {
    return (
      <div className="p-4 border-t">
        <p>チャット回数が上限に達しました</p>
      </div>
    );
  }

  return (
    <div className="border-t p-4">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力..."
          rows={1}
          className="flex-1 resize-none min-h-[44px] max-h-[120px]"
        />
        <button
          onClick={handleSend}
          disabled={!message.trim()}
        >
          送信
        </button>
      </div>
      <p className="text-xs mt-2">
        Enter で送信、Shift + Enter で改行 | 残り{chatCredits}回
      </p>
    </div>
  );
};
```

### textarea の自動高さ調整

```typescript
useEffect(() => {
  if (textareaRef.current) {
    textareaRef.current.style.height = 'auto';     // 一度リセット
    textareaRef.current.style.height =
      `${textareaRef.current.scrollHeight}px`;       // 内容に合わせる
  }
}, [message]);
```

`max-h-[120px]` でスクロール可能な上限を設け、短いメッセージでは1行、長いメッセージでは自動的に広がります。

## チャットルーム一覧: 未読バッジとソート

### ルーム一覧アイテム

```tsx
const ChatListItem = ({ room, isSelected, onSelect }: ChatListItemProps) => (
  <button onClick={() => onSelect(room.chatRoomId)} className="w-full text-left">
    <div className="flex items-center gap-3 p-3">
      {/* アイコン: direct は人物、group はグループ */}
      <Icon name={room.type === 'direct' ? 'person' : 'group'} />

      <div className="flex-1">
        <div className="flex items-center justify-between">
          <h3 className="truncate">{room.name}</h3>
          {/* 未読バッジ */}
          {(room.unreadCount ?? 0) > 0 && (
            <span className="bg-gold text-white text-xs font-bold rounded-full px-1.5">
              {room.unreadCount}
            </span>
          )}
        </div>
        <div className="flex justify-between">
          <p className="truncate text-xs">{room.lastMessage}</p>
          <span className="text-xs">{formatTime(room.lastMessageAt)}</span>
        </div>
      </div>
    </div>
  </button>
);
```

### レスポンシブレイアウト

```
デスクトップ (md 以上):
┌──────────────┬─────────────────────────┐
│  サイドバー    │   チャットルーム         │
│  (ルーム一覧)  │   (メッセージ + 入力)    │
│  w-80〜w-96   │   flex-1               │
└──────────────┴─────────────────────────┘

モバイル:
  ルーム一覧 ↔ チャットルーム をトグル切替
  showList 状態で表示を切り替え
```

```tsx
{/* サイドバー: モバイルではルーム表示中は非表示 */}
<div className={`${showList ? 'flex' : 'hidden'} md:flex w-full md:w-80`}>
  {sidebarContent}
</div>

{/* チャット: モバイルではルーム一覧表示中は非表示 */}
<div className={`${showList ? 'hidden' : 'flex'} md:flex flex-1`}>
  {selectedRoomId ? <ChatRoomPanel /> : <NoChatSelected />}
</div>
```

## スクロール制御

新しいメッセージが追加されたとき、自動的に最下部にスクロールします。

```typescript
const messagesEndRef = useRef<HTMLDivElement>(null);
const isInitialLoad = useRef(true);

useEffect(() => {
  if (isInitialLoad.current && messages.length > 0) {
    // 初回読み込み: アニメーションなしで即座に最下部へ
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    isInitialLoad.current = false;
  } else if (!isInitialLoad.current) {
    // 新メッセージ追加: スムーズにスクロール
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
}, [messages]);

// ルーム切替時にリセット
useEffect(() => {
  isInitialLoad.current = true;
}, [roomId]);
```

初回はアニメーションなし（`instant`）で即座に、追加メッセージは `smooth` でスクロール。ルームを切り替えたらフラグをリセットします。

## ポイント・注意点

### WebSocket URL は環境変数で管理

```typescript
const WS_URL = import.meta.env.VITE_WEBSOCKET_ENDPOINT || 'ws://localhost:3001';
```

CDK の WebSocket Stack が出力する `wss://` エンドポイントを Vite の環境変数に設定します。

### ブラウザ WebSocket API の制約

HTTP ヘッダーに `Authorization` を設定できないため、トークンはクエリパラメータで渡します（第2回の $connect Lambda が受け取る）。

### プロフィールの非同期取得

チャットルームの参加者名とアバターは、ルームを開いたときに非同期で取得します：

```typescript
useEffect(() => {
  const otherIds = currentRoom.participantIds.filter((id) => id !== currentUserId);
  Promise.all(
    otherIds.map(async (id) => {
      const profile = await getPublicProfile(id);
      return { id, nickname: profile.nickname, profilePhoto: profile.profilePhoto };
    })
  ).then((profiles) => {
    setSenderProfiles(new Map(profiles.map((p) => [p.id, p])));
  });
}, [currentRoom?.participantIds]);
```

メッセージデータにはプロフィール情報を含めず、`senderId` だけを保持します。表示時に Map でルックアップすることで、データの重複を防ぎつつ最新のプロフィール情報を表示できます。

## まとめ

第4回では、React フロントエンドを実装してチャット機能を完成させました：

- **WebSocketService** は再接続（指数バックオフ）とハートビート（30秒間隔）で接続を維持
- **Zustand Chat Store** は `messageId` + `senderId/content/timestamp` の2段階で重複排除
- **楽観的更新** で送信ボタンを押した瞬間にメッセージを表示し、失敗時はロールバック
- **MessageBubble** はシステム/相手/自分の3タイプを `memo` でパフォーマンス最適化
- **タブ復帰時の再接続** で `visibilitychange` イベントを活用

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> React + TypeScript で WebSocket チャットのフロントエンドを実装してください。
>
> 技術スタック: React 18+, TypeScript, Zustand, Vite
>
> WebSocketService クラス:
> - コンストラクタで url と getAccessToken 関数を受け取る
> - connect(): クエリパラメータ `?token=JWT` で WebSocket 接続。Promise を返す
> - disconnect(): intentionalClose フラグを true にしてから close
> - sendMessage(action, data): `{ action, ...data }` を JSON で送信
> - onMessage(handler): メッセージハンドラーを登録し、購読解除関数を返す
> - 再接続: 最大5回、指数バックオフ（1s, 2s, 4s, 8s, 16s）
> - ハートビート: 30秒間隔で `{ action: 'ping' }` を送信
> - シングルトンで管理（getWebSocketService / disconnectWebSocket）
>
> Zustand Chat Store:
> - Message 型: messageId, chatRoomId, senderId, content, messageType, readBy: string[], createdAt, timestamp
> - ChatRoom 型: chatRoomId, name, participantIds, type, unreadCount
> - addMessage: messageId の完全一致 OR (senderId + content + 5秒以内) で重複排除
> - markAsRead: new Set で readBy に userId を追加（重複防止）
> - updateUnreadCount: ルーム一覧の未読バッジ用
>
> 楽観的更新:
> - 送信時に crypto.randomUUID() で仮IDのメッセージを即座に addMessage
> - WebSocket 送信失敗時は removeMessage でロールバック
>
> MessageBubble (memo):
> - system: 中央揃えの区切りテキスト
> - 相手: 左寄せ、アバター + ニックネーム表示
> - 自分: 右寄せ、readBy.length > 1 で「既読」表示
>
> タブ復帰再接続:
> - visibilitychange で非表示時刻を記録
> - 30秒以上非表示 or 接続切れ → 自動再接続

---

これで「サーバーレスでリアルタイムチャット構築」シリーズは完結です。第1回から順に読むことで、インフラ設計からフロントエンド実装まで一貫した理解が得られます。
