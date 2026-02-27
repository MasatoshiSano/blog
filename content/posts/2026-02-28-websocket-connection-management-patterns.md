---
title: "本番で使えるWebSocket接続管理パターン — 再接続・ハートビート・ゾンビ接続対策"
emoji: "🔌"
type: "tech"
topics: ["WebSocket", "TypeScript", "React", "AWS", "Realtime", "Chat"]
published: true
category: "HowTo"
date: "2026-02-28"
description: "WebSocketの接続を本番運用レベルで安定させるためのパターン集。指数バックオフ再接続、ハートビート、ゾンビ接続の検知と削除、タブ切替時の再接続、メッセージ重複排除を実装コード付きで解説する。"
---

## 概要

WebSocket接続は「繋がったら終わり」ではない。本番環境では、ネットワーク断、サーバー側タイムアウト、ブラウザタブの非アクティブ化など、接続が切れる場面が頻繁に発生する。

この記事では、API Gateway WebSocket + React フロントエンドの構成で、以下の接続管理パターンを実装コード付きで解説する：

1. **指数バックオフ再接続** — 切断時の自動復旧
2. **ハートビート** — アイドルタイムアウトの回避
3. **ゾンビ接続の検知と削除** — サーバー側のステール接続対策
4. **ゾンビ接続の防止** — クライアント側の多重接続対策
5. **タブ切替時の再接続** — Visibility API活用
6. **メッセージ重複排除** — 楽観的更新との共存

## 前提条件

- API Gateway WebSocket API（アイドルタイムアウト: 10分）
- Lambda + DynamoDB（バックエンド）
- React + TypeScript + Zustand（フロントエンド）

## パターン1: 指数バックオフ再接続

WebSocket接続が予期せず切れた場合に、自動で再接続を試みる。ただし即座にリトライすると、サーバーが過負荷の場合にさらに悪化させる。指数バックオフで待機時間を徐々に増やす。

```typescript
export class WebSocketService {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 初回1秒
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): Promise<void> {
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      const token = this.getAccessToken();
      this.ws = new WebSocket(`${this.url}?token=${token}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0; // 成功したらリセット
        resolve();
      };

      this.ws.onclose = () => {
        if (!this.intentionalClose) {
          this.attemptReconnect();
        }
      };
    });
  }

  disconnect(): void {
    this.intentionalClose = true; // 意図的切断フラグ
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return; // UIにエラー表示を委譲
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    // 1回目: 1s, 2回目: 2s, 3回目: 4s, 4回目: 8s, 5回目: 16s

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // connect内のoncloseが再度attemptReconnectを呼ぶ
      });
    }, delay);
  }
}
```

**設計のポイント:**

- **`intentionalClose` フラグ**: `disconnect()` による意図的な切断と、ネットワーク断による予期しない切断を区別する。意図的切断では再接続しない
- **成功時リセット**: `onopen` で `reconnectAttempts = 0` にリセット。一度復旧すれば次の切断でもフレッシュな状態から再接続を試みる
- **最大リトライ回数**: 5回（合計待機: 1+2+4+8+16 = 31秒）で打ち切り。無限リトライは避ける

## パターン2: ハートビート

API Gateway WebSocketのアイドルタイムアウトは**10分**。何もメッセージを送受信しないと接続が自動で切断される。30秒間隔のpingで接続を維持する。

```typescript
private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

private startHeartbeat(): void {
  this.stopHeartbeat();
  this.heartbeatInterval = setInterval(() => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'ping' }));
    }
  }, 30000); // 30秒間隔
}

private stopHeartbeat(): void {
  if (this.heartbeatInterval !== null) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }
}
```

**なぜ30秒なのか？**

- API Gatewayのアイドルタイムアウトは10分（600秒）
- 30秒間隔なら、ネットワーク遅延やパケットロスがあっても余裕がある
- 短すぎると不要なLambda呼び出しが増えてコスト増。30秒は実用的なバランス

**サーバー側の `$default` ハンドラ:**

`ping` アクションにはカスタムルートを定義せず、`$default` ルートで受ける。200を返すだけ：

```typescript
export const handler = async () => {
  return { statusCode: 200, body: 'OK' };
};
```

## パターン3: ゾンビ接続の検知と削除（サーバー側）

ネットワーク断で `$disconnect` イベントが発火しなかった場合、DynamoDBにコネクションレコードが残り続ける（ゾンビ接続）。メッセージ配信時にゾンビを検知して削除する。

```typescript
// sendMessage Lambda内のブロードキャスト処理
await Promise.allSettled(
  connections.map(async (connId) => {
    try {
      await apiGatewayClient.send(
        new PostToConnectionCommand({
          ConnectionId: connId,
          Data: Buffer.from(messageData),
        })
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'GoneException') {
        console.log(`Stale connection detected: ${connId}`);

        // 接続メタデータを取得してuserIdを特定
        const connRecord = await ddbDocClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `CONNECTION#${connId}`, SK: 'METADATA' },
          })
        );
        const userId = connRecord.Item?.userId;

        // 双方向マッピングの両レコードを削除
        const deletePromises = [
          ddbDocClient.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: `CONNECTION#${connId}`, SK: 'METADATA' },
          })),
        ];
        if (userId) {
          deletePromises.push(
            ddbDocClient.send(new DeleteCommand({
              TableName: TABLE_NAME,
              Key: { PK: `USER#${userId}`, SK: `CONNECTION#${connId}` },
            }))
          );
        }
        await Promise.all(deletePromises);
      }
    }
  })
);
```

**3層のゾンビ対策:**

| レイヤー | メカニズム | タイミング |
|---------|----------|----------|
| 即時 | `$disconnect` ハンドラ | 正常切断時 |
| 遅延 | `GoneException` 検知 | メッセージ配信時 |
| 最終手段 | DynamoDB TTL (24h) | 上記すべてが漏れた場合 |

## パターン4: ゾンビ接続の防止（クライアント側）

ブラウザの同一タブで複数のWebSocket接続が張られる問題を防ぐ。React の `useEffect` のクリーンアップが不完全だったり、HMR（Hot Module Replacement）で再マウントされた場合に起きがち。

```typescript
connect(): Promise<void> {
  // 既存のゾンビ接続をクリーンアップ
  if (this.ws) {
    this.ws.onclose = null; // 再接続トリガーを無効化
    this.ws.close();
    this.ws = null;
    this.stopHeartbeat();
  }

  this.intentionalClose = false;

  return new Promise((resolve, reject) => {
    this.ws = new WebSocket(`${this.url}?token=${token}`);
    // ...
  });
}
```

**`this.ws.onclose = null` が重要な理由:**

古い接続を `close()` すると `onclose` が発火し、`attemptReconnect` が呼ばれてしまう。新しい接続を張ろうとしているのに、古い接続の再接続ロジックも動くと、接続が2重になる。`onclose = null` で無効化してから `close()` する。

さらに、シングルトンパターンでインスタンスを1つに制限する：

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

export function disconnectWebSocket(): void {
  if (wsService) {
    wsService.disconnect();
    wsService = null;
  }
}
```

## パターン5: タブ切替時の再接続

ブラウザのタブが非アクティブになると、タイマーがスロットリングされてハートビートが止まり、接続が切れることがある。Visibility APIでタブのアクティブ化を検知して再接続する。

```typescript
// React コンポーネント内
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // タブがアクティブになったとき
      if (!wsService.isConnected()) {
        wsService.connect().catch(console.error);
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}, []);
```

**なぜ必要か？**

- Chrome等のブラウザは非アクティブタブの `setInterval` を最小1秒に制限する
- バックグラウンドのタブでは、30秒ハートビートが実質的に1秒間隔に「圧縮」されるが、より長い非アクティブ期間（5分以上）ではネットワーク接続自体がドロップされることがある
- タブに戻ったときに `isConnected()` でチェックし、切断されていれば即座に再接続

## パターン6: メッセージ重複排除

楽観的更新（送信ボタン押下時にUIに即座に表示）とWebSocketブロードキャスト（サーバーから全参加者に配信）の両方でメッセージを受け取るため、重複が発生する。

```typescript
// Zustand ストア
addMessage: (message) =>
  set((state) => {
    const isDuplicate = state.messages.some(
      (m) =>
        // チェック1: messageIdの完全一致
        m.messageId === message.messageId ||
        // チェック2: 同一送信者 + 同一内容 + 5秒以内
        (m.senderId === message.senderId &&
          m.content === message.content &&
          Math.abs(m.timestamp - message.timestamp) < 5000)
    );
    if (isDuplicate) return state; // 既存stateをそのまま返す（再レンダリングなし）
    return { messages: [...state.messages, message] };
  }),
```

**2段階チェックの理由:**

| チェック | 対象 | 発生パターン |
|---------|------|-------------|
| `messageId` 一致 | 同一メッセージの重複 | サーバーがブロードキャストしたメッセージのIDが、楽観的に追加したメッセージのIDと一致 |
| 送信者+内容+5秒 | IDが異なる重複 | 楽観的追加時にクライアント側で生成したUUIDと、サーバー側で生成したUUIDが異なる場合 |

5秒の閾値は「通常のメッセージ送信→ブロードキャスト受信」のラウンドトリップに十分な余裕を持たせている。

## 接続状態のUIフィードバック

接続状態をZustandストアで管理し、UIに反映する：

```typescript
// ストア
interface ChatState {
  isConnected: boolean;
  setConnected: (connected: boolean) => void;
}

// WebSocketサービスから状態を更新
ws.onopen = () => {
  useChatStore.getState().setConnected(true);
};

ws.onclose = () => {
  useChatStore.getState().setConnected(false);
};

// コンポーネントで表示
function ConnectionStatus() {
  const isConnected = useChatStore((state) => state.isConnected);

  if (!isConnected) {
    return (
      <div className="bg-yellow-100 text-yellow-800 p-2 text-center">
        接続が切れています。再接続中...
      </div>
    );
  }
  return null;
}
```

## まとめ

| パターン | 解決する問題 | 実装場所 |
|---------|-------------|---------|
| 指数バックオフ再接続 | ネットワーク断からの自動復旧 | フロントエンド |
| ハートビート（30秒ping） | API Gatewayの10分アイドルタイムアウト | フロントエンド |
| GoneException検知 | サーバー側のゾンビ接続 | バックエンド（Lambda） |
| DynamoDB TTL（24h） | 全検知漏れのセーフティネット | インフラ |
| ゾンビ接続防止 | クライアント側の多重接続 | フロントエンド |
| Visibility API再接続 | タブ非アクティブ中の切断 | フロントエンド |
| メッセージ重複排除 | 楽観的更新とブロードキャストの衝突 | フロントエンド（ストア） |

WebSocketは「接続を確立する」ことよりも「接続を維持し、切れたら復旧する」ことの方がはるかに難しい。上記のパターンを組み合わせることで、本番環境で安定したリアルタイム通信を実現できる。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト例:

> React + TypeScript + Zustand のフロントエンドで、WebSocket接続管理サービスを実装してください。
>
> 要件:
> 1. WebSocketServiceクラス（シングルトン）:
>    - `connect()`: `wss://endpoint?token=xxx` で接続。既存接続があれば `onclose=null` で無効化してから `close()` し、新規接続を作成
>    - `disconnect()`: `intentionalClose=true` を設定してから `close()`。再接続タイマーもクリア
>    - `sendMessage(action, data)`: JSON.stringifyして送信
>    - `onMessage(handler)`: Setベースのハンドラ登録。返り値は解除関数
>    - `isConnected()`: readyState === OPEN のチェック
>
> 2. 指数バックオフ再接続:
>    - 初回1秒、以降2倍 (1s→2s→4s→8s→16s)、最大5回
>    - `intentionalClose` の場合は再接続しない
>    - 接続成功時に `reconnectAttempts = 0` にリセット
>
> 3. ハートビート:
>    - 30秒間隔で `{ action: 'ping' }` を送信
>    - `onopen` で開始、`onclose` で停止
>
> 4. タブ切替再接続:
>    - Reactコンポーネントの `useEffect` で `visibilitychange` を監視
>    - タブがvisibleになったとき `isConnected()` がfalseなら `connect()` 呼び出し
>
> 5. メッセージ重複排除（Zustandストア）:
>    - `addMessage` で追加前に重複チェック: messageId一致 OR (senderId+content一致 AND timestamp差5秒以内)
>    - 重複なら既存stateを返してスキップ
>
> 6. バックエンド（Lambda）のGoneException処理:
>    - `PostToConnectionCommand` で `GoneException` をキャッチ
>    - 接続メタデータからuserIdを取得し、双方向レコード（CONNECTION#+METADATA, USER#+CONNECTION#）を削除
>    - `Promise.allSettled` で全コネクションに並列配信し、1つの失敗が他を止めない設計にする
>
> 注意点:
> - `connect()` 時に古い接続の `onclose` をnullにしないと、再接続ロジックが多重発火する
> - `setInterval` はバックグラウンドタブでスロットリングされるため、Visibility APIによる補完が必要
> - DynamoDB TTL(24h)をセーフティネットとして設定し、GoneExceptionの漏れに対応する
