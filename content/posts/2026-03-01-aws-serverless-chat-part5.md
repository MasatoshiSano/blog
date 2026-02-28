---
title: "ReactでリアルタイムチャットUIを作る — WebSocketクライアントとOptimistic UI"
emoji: "💬"
type: "tech"
topics: ["React", "WebSocket", "Zustand", "TypeScript", "Chat"]
published: true
category: "HowTo"
date: "2026-03-01"
description: "React + Zustandでリアルタイムチャット画面を実装。WebSocketクライアントの再接続・ハートビート、Optimistic UIによる即座のメッセージ表示、重複メッセージ防止まで"
series: "AWSサーバーレスチャット実装"
seriesOrder: 5
coverImage: "/images/posts/aws-serverless-chat-part5-cover.jpg"
---

> **このシリーズ: 全5回**
> 1. [第1回: リアルタイム通信の選択肢 — ポーリング・SSE・WebSocketを比較する](/posts/aws-serverless-chat-part1)
> 2. [第2回: DynamoDB Single Table Designでチャットを設計する](/posts/aws-serverless-chat-part2)
> 3. [第3回: CDKでWebSocket APIを構築する](/posts/aws-serverless-chat-part3)
> 4. [第4回: WebSocket Lambdaの実装 — JWT認証・ブロードキャスト・切断処理](/posts/aws-serverless-chat-part4)
> 5. ReactでリアルタイムチャットUIを作る — WebSocketクライアントとOptimistic UI ← 今ここ

## 概要

ここまでの4回でバックエンド（DynamoDB + API Gateway WebSocket + Lambda）を構築した。最終回では、そのバックエンドと通信する **フロントエンド** を実装する。

フロントエンドで扱う課題は:
- WebSocket接続の管理（接続・切断・再接続・ハートビート）
- Zustandでのチャット状態管理
- Optimistic UI（メッセージを即座に表示し、失敗時にロールバック）
- 重複メッセージの防止
- タブ非表示→復帰時の再接続

## こんな人向け

- ReactでWebSocketを使うときの設計パターンを知りたい
- Zustandでリアルタイムデータを管理する方法を知りたい
- Optimistic UIの具体的な実装方法を知りたい
- WebSocketの再接続やハートビートの実装に悩んでいる

## WebSocketサービスクラス

WebSocketの接続管理はReactコンポーネントから分離して、独立したサービスクラスにする。

### なぜコンポーネントに直接書かないのか

```
❌ コンポーネントに直接書く:
  - ページ遷移のたびにWebSocket接続が切れる
  - 再接続ロジックがUIロジックと混ざって複雑になる
  - テストが困難

✅ サービスクラスに分離:
  - コンポーネントのライフサイクルから独立
  - 接続管理の責務が明確に分離
  - シングルトンで接続を使い回せる
```

### 実装

```typescript
type MessageHandler = (data: Record<string, unknown>) => void;

export class WebSocketService {
  private ws: WebSocket | null;
  private messageHandlers: Set<MessageHandler>;
  private reconnectAttempts: number;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private heartbeatInterval: ReturnType<typeof setInterval> | null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null;
  private intentionalClose: boolean;
  private url: string;
  private getAccessToken: () => string | null;

  constructor(url: string, getAccessToken: () => string | null) {
    this.url = url;
    this.getAccessToken = getAccessToken;
    this.ws = null;
    this.messageHandlers = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.heartbeatInterval = null;
    this.reconnectTimer = null;
    this.intentionalClose = false;
  }
```

**`getAccessToken` をコンストラクタで受け取る理由**: トークンは有効期限がある。接続時に毎回最新のトークンを取得するために、値ではなく関数を渡す。

### 接続と再接続

```typescript
  connect(): Promise<void> {
    // 既存のゾンビ接続をクリーンアップ
    if (this.ws) {
      this.ws.onclose = null; // 旧接続のcloseで再接続が走らないように
      this.ws.close();
      this.ws = null;
      this.stopHeartbeat();
    }

    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      const token = this.getAccessToken();
      if (!token) {
        reject(new Error('No access token available'));
        return;
      }

      // クエリパラメータでトークンを渡す（第4回のconnect.tsで受け取る）
      const wsUrl = `${this.url}?token=${token}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;  // 成功したらリセット
        this.startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        this.messageHandlers.forEach((handler) => handler(message));
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        if (!this.intentionalClose) {
          this.attemptReconnect();  // 意図しない切断のみ再接続
        }
      };

      this.ws.onerror = (error) => reject(error);
    });
  }
```

**ゾンビ接続の処理**: `connect()` が2回連続で呼ばれた場合、古い接続が残ったまま新しい接続が作られる。古い接続の `onclose` をnullにしてから閉じることで、不要な再接続の連鎖を防ぐ。

### Exponential Backoffによる再接続

```typescript
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    // 1回目: 1秒、2回目: 2秒、3回目: 4秒、4回目: 8秒、5回目: 16秒

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }
```

**Exponential Backoff**: 再接続の間隔を指数関数的に増やす。サーバーに障害が起きた場合、全クライアントが同時に再接続を試みるとさらに負荷がかかる。バックオフで負荷を分散する。

```
再接続タイムライン:
──×─[1s]─再接続──×─[2s]─再接続──×─[4s]─再接続──✓ 成功
  切断     待機              待機              待機
```

### ハートビート

```typescript
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'ping' }));
      }
    }, 30000); // 30秒ごと
  }
```

**なぜハートビートが必要か**: API Gateway WebSocket APIは**アイドルタイムアウト10分**が設定されている。何もメッセージを送らないまま10分経つと、API Gatewayが接続を切断する。30秒ごとに `ping` を送って接続を維持する。

### シングルトンパターン

```typescript
let wsService: WebSocketService | null = null;

export function getWebSocketService(
  url?: string,
  getAccessToken?: () => string | null
): WebSocketService {
  if (!wsService && url && getAccessToken) {
    wsService = new WebSocketService(url, getAccessToken);
  }
  if (!wsService) {
    throw new Error('WebSocketService not initialized');
  }
  return wsService;
}
```

アプリ全体で1つの接続を共有する。チャットルームを切り替えても、WebSocket接続自体は維持される。

## Zustand Store — チャット状態管理

### なぜZustandか

| ライブラリ | チャットに向いている点 | 向いていない点 |
|-----------|---------------------|-------------|
| **useState** | シンプル | コンポーネント間での共有が面倒 |
| **React Context** | 共有は簡単 | 更新のたびに全消費コンポーネントが再レンダリング |
| **Redux** | 大規模に強い | ボイラープレートが多い |
| **Zustand** | 軽量 + セレクタで最小再レンダリング | （特になし） |

チャットは「メッセージが高頻度で追加される」ため、**不要な再レンダリングを避ける** ことが重要。Zustandのセレクタ機能でこれを実現する。

### Store定義

```typescript
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
}

export const useChatStore = create<ChatState>((set) => ({
  rooms: [],
  currentRoom: null,
  messages: [],
  isConnected: false,
  // ... アクション定義
}));
```

### 重複メッセージの防止

チャットでは **同じメッセージが2回表示される** 問題が起きやすい:

```
1. ユーザーAがメッセージを送信
2. Optimistic UIで即座にローカルstateに追加 (messageId: "local-123")
3. サーバーで処理され、WebSocketでブロードキャスト
4. ユーザーA自身もそのブロードキャストを受信 (messageId: "local-123")
5. → 同じメッセージが2つ表示される！
```

`addMessage` でこれを防ぐ:

```typescript
addMessage: (message) =>
  set((state) => {
    const isDuplicate = state.messages.some(
      (m) =>
        // messageIdが一致（Optimistic追加 + WebSocket受信の重複）
        m.messageId === message.messageId ||
        // 同じ送信者・同じ内容・5秒以内（IDが異なるケース対策）
        (m.senderId === message.senderId &&
          m.content === message.content &&
          Math.abs(m.timestamp - message.timestamp) < 5000)
    );
    if (isDuplicate) return state; // 何も変更しない
    return { messages: [...state.messages, message] };
  }),
```

**2つの重複判定基準**:
1. **messageIdの一致**: Optimistic UIで追加したメッセージとWebSocketで受信した同じメッセージ
2. **送信者+内容+時間の一致**: ネットワーク遅延でmessageIdが変わった場合のフォールバック

## Optimistic UI — 即座のフィードバック

### Optimistic UIとは

```
通常のUI:                    Optimistic UI:
送信ボタン押す                送信ボタン押す
  ↓                           ↓
サーバーに送信 (200ms)        ① 即座にローカルstateに追加（見た目に表示）
  ↓                           ② 同時にサーバーに送信
サーバーから応答                 ↓ (200ms)
  ↓                          サーバーから応答
画面に表示                      ↓
                             ✓ 成功 → そのまま（何もしない）
合計: 200ms+                  ✗ 失敗 → ローカルから削除（ロールバック）

                             合計: 0ms（体感）
```

ユーザーの体感では「送信ボタンを押した瞬間にメッセージが表示される」。

### 実装

```typescript
const handleSendMessage = useCallback(async (content: string) => {
  const wsService = getWebSocketService(WS_URL, () => idToken);

  // 接続チェック・再接続
  if (!wsService.isConnected()) {
    try {
      await wsService.connect();
    } catch {
      setSendError('接続に失敗しました。ページを更新してください。');
      return;
    }
  }

  const { userId } = useAuthStore.getState();
  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();

  // ① Optimistic: 即座にローカルに追加
  addMessage({
    messageId,
    chatRoomId: chatRoomId!,
    senderId: userId || '',
    content,
    messageType: 'user',
    readBy: [],
    createdAt: now,
    timestamp: Date.now(),
  });

  try {
    // ② サーバーに送信
    wsService.sendMessage('sendMessage', {
      chatRoomId,
      content,
    });
  } catch (err) {
    // ③ 失敗時: ローカルから削除（ロールバック）
    removeMessage(messageId);
    setSendError('メッセージの送信に失敗しました。');
  }
}, [chatRoomId, idToken, addMessage, removeMessage]);
```

**`crypto.randomUUID()` でクライアント側でIDを生成する理由**: Optimistic UIではサーバーのレスポンスを待たずにローカルに追加する。サーバーが返すIDを待っていたらOptimisticにならない。クライアントで生成したUUIDをそのままサーバーにも送り、同一IDとして扱う。

## タブ非表示→復帰時の再接続

ブラウザのタブを非アクティブにすると、OSやブラウザがWebSocket接続を切断することがある。タブに戻ったときに接続状態を確認し、必要に応じて再接続する:

```typescript
useEffect(() => {
  if (!chatRoomId) return;

  const handleVisibilityChange = async () => {
    if (document.hidden) {
      hiddenAtRef.current = Date.now();
      return;
    }

    // タブが再表示された
    const hiddenMs = hiddenAtRef.current
      ? Date.now() - hiddenAtRef.current
      : 0;
    const wsService = getWebSocketService(WS_URL, () => idToken);

    // 30秒以上非表示だった or 接続が切れている場合に再接続
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
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, [chatRoomId, idToken, setConnected]);
```

**30秒の閾値**: API Gatewayのアイドルタイムアウト（10分）よりかなり短いが、モバイルブラウザではOSがバックグラウンドのWebSocket接続を積極的に切断する。30秒以上非表示だった場合は念のため再接続する。

## WebSocketメッセージの受信

```typescript
useEffect(() => {
  if (!chatRoomId) return;

  const wsService = getWebSocketService(WS_URL, () => idToken);
  wsService.connect().then(() => setConnected(true));

  const unsubscribe = wsService.onMessage((message) => {
    if (message.type === 'message' && message.data) {
      const data = message.data as Record<string, unknown>;

      // 現在開いているルームのメッセージのみ追加
      if (data.chatRoomId === chatRoomId) {
        addMessage({
          messageId: data.messageId as string,
          chatRoomId: data.chatRoomId as string,
          senderId: data.senderId as string,
          content: data.content as string,
          messageType: data.messageType === 'system' ? 'system' : 'user',
          createdAt: data.createdAt as string,
          readBy: (data.readBy as string[]) || [],
          timestamp: typeof data.timestamp === 'number'
            ? data.timestamp
            : Date.now(),
        });
      }
    }
  });

  return () => {
    unsubscribe();
    wsService.disconnect();
    setConnected(false);
  };
}, [chatRoomId, idToken, addMessage, setConnected]);
```

**`data.chatRoomId === chatRoomId` のフィルタリング**: WebSocket接続は全ルーム共通の1本。サーバーから届くメッセージには `chatRoomId` が含まれるので、現在表示しているルームのメッセージのみstateに追加する。

## まとめ

| 実装ポイント | 方式 | 理由 |
|-------------|------|------|
| WebSocket管理 | サービスクラス + シングルトン | コンポーネントライフサイクルから独立 |
| 再接続 | Exponential Backoff（最大5回） | サーバー負荷の分散 |
| ハートビート | 30秒間隔でping | API Gatewayの10分アイドルタイムアウト対策 |
| 状態管理 | Zustand | セレクタで最小再レンダリング |
| メッセージ表示 | Optimistic UI + ロールバック | 0msの体感レスポンス |
| 重複防止 | messageId + 送信者/内容/時間の二重チェック | Optimistic追加 + WebSocket受信の重複を排除 |
| タブ復帰 | visibilitychange + 30秒閾値 | モバイルブラウザの接続切断対策 |

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> ReactでWebSocketチャットのフロントエンドを実装してほしい。
>
> 1. **WebSocketService クラス** (services/websocket.ts)
>    - コンストラクタ: url + getAccessToken関数を受け取る
>    - connect(): `wss://url?token=xxx` で接続。Promiseを返す
>    - disconnect(): intentionalClose=trueで切断、ハンドラー全クリア
>    - sendMessage(action, data): JSON.stringifyして送信
>    - onMessage(handler): メッセージハンドラー登録、unsubscribe関数を返す
>    - 再接続: Exponential Backoff（1s, 2s, 4s, 8s, 16s）、最大5回
>    - ハートビート: 30秒ごとに `{"action":"ping"}` 送信
>    - シングルトン: getWebSocketService()で取得
>
> 2. **Zustand Store** (stores/chat.ts)
>    - 状態: rooms, currentRoom, messages, isConnected
>    - addMessage: messageId一致 or 送信者+内容+5秒以内で重複判定
>    - removeMessage: Optimisticロールバック用
>
> 3. **ChatRoomコンポーネント** (pages/chat/ChatRoom.tsx)
>    - useEffectでWebSocket接続・メッセージ受信ハンドラー登録
>    - handleSendMessage: Optimistic UI（即座にaddMessage → WebSocket送信 → 失敗時removeMessage）
>    - visibilitychangeイベントで30秒以上非表示後に再接続
>    - メッセージ追加時に自動スクロール（初回はinstant、以降はsmooth）

### エージェントに指示するときの注意点

- WebSocketServiceを「Reactコンポーネント内に書いて」と指示すると、useEffectの中で直接 `new WebSocket()` する実装になりがち。**サービスクラスとして分離** を明示する
- Optimistic UIのロールバック（`removeMessage`）を忘れやすい。「送信失敗時にどうするか」を明示的に指示する
- Zustandの `addMessage` で重複チェックを入れないと、自分の送ったメッセージが2回表示される。この挙動と対策を事前に伝える
- `visibilitychange` による再接続は忘れがち。モバイルでのテストで初めて気づくことが多い

---

これで「AWSサーバーレスチャット実装」シリーズは完結です。第1回から順に読むことで、技術選定からインフラ構築・バックエンド実装・フロントエンドUIまで一貫した理解が得られます。
