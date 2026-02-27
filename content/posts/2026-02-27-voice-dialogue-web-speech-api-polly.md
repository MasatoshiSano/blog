---
title: "AIチャットを完全音声化する — Web Speech API + Amazon Polly で双方向ボイス対話"
emoji: "🎙️"
type: "tech"
topics: ["WebSpeech", "Polly", "React", "AWS", "TypeScript", "Voice"]
published: true
category: "HowTo"
date: "2026-02-27"
description: "ブラウザのWeb Speech APIでユーザー音声を認識し、AIの応答をAmazon Pollyで読み上げる。ストリーミングチャットと組み合わせた双方向音声対話の実装パターンを紹介。バイブコーディング用のプロンプト例付き。"
---

## 概要

AIチャットアプリで「ユーザーも声で話す、AIも声で答える」双方向の音声対話を実現する方法を解説する。

使う技術は2つだけ:
- **ユーザーの声 → テキスト**: Web Speech API（ブラウザ標準）
- **AIのテキスト → 声**: Amazon Polly（Lambda Function URL経由）

ベクター検索や音声モデルの自前学習は不要。ブラウザAPIとAWSマネージドサービスの組み合わせで、実用的な音声対話を最短で実装できる。

### 読者が得られるもの

- Web Speech API のリアルタイム認識（interim結果 + 無音検知による自動送信）
- Amazon Polly Neural 音声の Lambda TTS エンドポイント構築
- `listening → processing → speaking → listening` のフェーズ制御パターン
- ストリーミングAI応答との統合方法
- **バイブコーディングでこの機能を実装するためのプロンプト例**

## 前提条件

- React 18+ / TypeScript
- AWS Lambda（Function URL）+ Amazon Polly
- AI チャットのストリーミング応答が既にあること（Bedrock, OpenAI等）

## アーキテクチャ

```text
┌─ ブラウザ ────────────────────────────────┐
│                                           │
│  [listening]  Web Speech API              │
│       │       SpeechRecognition           │
│       │       (ja-JP, continuous)          │
│       ▼       2秒無音で自動stop           │
│  [processing] sendMessage(transcript)     │
│       │       → Lambda (Bedrock)          │
│       │       ← NDJSON streaming          │
│       ▼                                   │
│  [speaking]   fetch(TTS Lambda)           │
│       │       → Polly SynthesizeSpeech    │
│       │       ← MP3 blob                  │
│       │       new Audio(blob).play()      │
│       ▼                                   │
│  [listening]  ← 再生終了で自動復帰        │
│                                           │
└───────────────────────────────────────────┘
```

4フェーズが自動的にループする。ユーザーはマイクボタンを1回押すだけで、ハンズフリーの対話が続く。

## バイブコーディングで実装するなら

Claude Code や Cursor などのAIコーディングツールで、以下のようなプロンプトを段階的に投げると、この音声対話機能を実装できる。

### Step 1: TTS Lambda を作る

```
Amazon Pollyを使ったTTS（テキスト読み上げ）用のLambda Function URLを作ってください。

要件:
- POST でテキストとvoiceIdを受け取り、MP3音声をBase64で返す
- 日本語Polly音声: Kazuha(Neural), Tomoko(Neural), Takumi(Neural), Mizuki(Standard)
- Neural音声にはEngine.NEURAL、Mizukiだけ Engine.STANDARD を使う（間違えると400エラーになる）
- テキスト上限3000文字のバリデーション
- JWT認証（Cognito IDトークン検証）
- リージョンはus-west-2（Pollyの日本語Neural音声が利用可能なリージョン）
```

### Step 2: 音声入力フックを作る

```
ブラウザのWeb Speech APIを使った音声入力のReactカスタムフックを作ってください。

要件:
- useVoiceInput(onTranscript: (text: string) => void) というインターフェース
- SpeechRecognition と webkitSpeechRecognition の両方に対応
- 言語は ja-JP、continuous: true、interimResults: true
- interimText（途中のテキスト）をリアルタイムで返す
- isSupported で Web Speech API 対応ブラウザか判定を返す
- TypeScriptの型は自前で定義する（@types/web-speech-apiは使わない）
```

### Step 3: 双方向音声対話フックを作る

```
音声入力 + AI応答 + Polly読み上げを統合した双方向音声対話フックを作ってください。

要件:
- 4フェーズの状態マシン: idle → listening → processing → speaking → listening（自動ループ）
- listening: Web Speech API で音声認識。2秒間の無音を検知したら自動で recognition.stop()
- processing: 認識テキストをAIに送信。ストリーミング応答を受信中
- speaking: ストリーミング完了後、応答全文を Polly TTS Lambda に送ってMP3を再生
- speaking 終了（audio.ended）: 自動で listening に戻る
- isStreaming（boolean）と streamedContent（string）を外部から受け取る
- isStreaming が true→false に変わった瞬間がストリーミング完了の検知ポイント
- useRef でフェーズを追跡する（useEffectのクロージャ問題対策）
- Audio の blob URL はメモリリーク防止のため ended/error で revokeObjectURL する
```

### Step 4: オーバーレイUIを作る

```
音声対話中のフルスクリーンオーバーレイUIコンポーネントを作ってください。

要件:
- フェーズに応じた表示切替: listening="お話しください..." / processing="考え中..."
- リアルタイムの文字起こし表示（確定テキスト + interim テキストをグレーで表示）
- AI応答テキストのリアルタイム表示
- Escキーまたは✕ボタンで終了
- フェーズに応じたCSSアニメーション（listening=パルス、processing=回転、speaking=波形）
- role="dialog" と aria-label でアクセシビリティ対応
```

### Step 5: 音声モード専用プロンプトを追加

```
AIのシステムプロンプトに音声対話モード用の指示を追加してください。

音声対話時（voiceMode=true）のAI応答ルール:
- 回答は1〜2文で端的に答える
- 箇条書きや長い説明は避ける
- 質問は一度に1つだけ
- 「はい」「いいえ」で答えられる確認を優先する
- 記号や括弧の多用は避ける（音声読み上げに不向き）

voiceMode はリクエストボディで送信し、ストリーミングチャットの Lambda で受け取ってプロンプトに反映する。
```

### バイブコーディングのコツ

**段階的に作る**のが重要。「音声対話を作って」と一発で投げると、AIが全体像を把握しきれず中途半端になりやすい。上記のように Step 1〜5 を順番に投げると、各ステップで動作確認しながら進められる。

特に **Step 3 のフェーズ制御** が最も複雑なので、このステップでは以下も伝えるとよい:

```
注意点:
- useEffect のクロージャ内では useState の最新値が見えない場合がある。
  フェーズは useRef で追跡し、useState にも同期する「ref + state 二重管理」パターンを使って。
- Polly TTS や Audio.play() が失敗しても対話を止めない。catch で startListening に戻す。
- recognitionRef.current を null チェックしてから操作する。
  前のインスタンスが残っていると二重起動でブラウザがクラッシュする。
```

## 実装の詳細

ここからは、バイブコーディングの裏側で実際に何が生成されるかの解説。自前で書く場合やAI生成コードのレビュー時に参考にしてほしい。

### 1. Web Speech API でユーザーの音声を認識する

ブラウザ標準の `SpeechRecognition` を使う。ベンダープレフィックス対応が必要。

```typescript
// Web Speech API のブラウザ互換取得
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const w = window as unknown as Record<string, SpeechRecognitionConstructor | undefined>
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
```

認識インスタンスの設定:

```typescript
const recognition = new SpeechRecognition()
recognition.lang = 'ja-JP'        // 日本語
recognition.continuous = true      // 連続認識（手動stopまで）
recognition.interimResults = true  // 途中結果も取得（リアルタイム表示用）
```

**ポイント: 無音検知で自動送信する**

`continuous: true` だと認識が終わらないので、2秒間の無音を検知して `recognition.stop()` を呼ぶ。

```typescript
const SILENCE_TIMEOUT_MS = 2000

recognition.onresult = (event) => {
  // 結果が来るたびにタイマーをリセット
  clearTimeout(silenceTimer)

  let interim = ''
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i]
    if (result?.[0]) {
      if (result.isFinal) {
        transcript += result[0].transcript  // 確定テキスト
      } else {
        interim += result[0].transcript     // 途中テキスト（UI表示用）
      }
    }
  }

  // 2秒間新しい結果が来なければ認識終了
  silenceTimer = setTimeout(() => {
    recognition.stop()
  }, SILENCE_TIMEOUT_MS)
}
```

`onend` で認識が終了したら、テキストが空でなければAIに送信する:

```typescript
recognition.onend = () => {
  const text = transcript.trim()
  if (text) {
    setPhase('processing')
    sendMessage(text)  // AIチャットに送信
  } else {
    startListening()   // 空なら再度リスニング開始
  }
}
```

### 2. Amazon Polly の TTS Lambda を作る

AIの応答テキストを音声に変換するLambdaエンドポイント。

```typescript
// amplify/functions/tts/handler.ts
import {
  PollyClient, SynthesizeSpeechCommand,
  Engine, OutputFormat, VoiceId
} from '@aws-sdk/client-polly'

const VALID_VOICES: Record<string, VoiceId> = {
  Kazuha: VoiceId.Kazuha,   // Neural（女性・自然）
  Tomoko: VoiceId.Tomoko,   // Neural（女性・落ち着き）
  Takumi: VoiceId.Takumi,   // Neural/Standard（男性）
  Mizuki: VoiceId.Mizuki,   // Standard（女性・旧世代）
}

const pollyClient = new PollyClient({ region: 'us-west-2' })

export const handler = async (event: FunctionUrlEvent) => {
  // JWT認証（省略）...

  const { text, voiceId } = body
  if (text.length > 3000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'text too long (max 3000)' }) }
  }

  const resolvedVoice = VALID_VOICES[voiceId ?? ''] ?? VoiceId.Kazuha

  // Kazuha/Tomoko はNeural専用、Mizuki はStandard専用
  const engine = resolvedVoice === VoiceId.Mizuki ? Engine.STANDARD : Engine.NEURAL

  const command = new SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: OutputFormat.MP3,
    VoiceId: resolvedVoice,
    Engine: engine,
    LanguageCode: 'ja-JP',
  })

  const result = await pollyClient.send(command)

  // ストリームをバッファに変換してBase64で返す
  const chunks: Uint8Array[] = []
  for await (const chunk of result.AudioStream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
    isBase64Encoded: true,
    body: Buffer.concat(chunks).toString('base64'),
  }
}
```

**Polly の音声エンジン選択の注意点**:

| 音声 | エンジン | 特徴 |
|------|---------|------|
| Kazuha | Neural | 最も自然。2024年追加の新音声 |
| Tomoko | Neural | 落ち着いたトーン |
| Takumi | Neural / Standard | 男性声。両エンジン対応 |
| Mizuki | Standard のみ | 旧世代。Neural非対応 |

Neural音声に `Engine.STANDARD` を指定すると400エラーになる。逆も同様。音声ごとにエンジンを正しく切り替える必要がある。

### 3. フロントエンドから Polly を呼ぶ

```typescript
async function speakWithPolly(text: string, voiceId = 'Kazuha'): Promise<HTMLAudioElement> {
  const session = await fetchAuthSession()
  const idToken = session.tokens?.idToken?.toString()

  const response = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ text, voiceId }),
  })

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)

  // メモリリーク防止: 再生終了後にblob URLを解放
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
  audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })

  return audio
}
```

### 4. フェーズ制御で全体をつなげる

4つのフェーズを状態マシンとして管理する:

```typescript
type VoiceDialoguePhase = 'idle' | 'listening' | 'processing' | 'speaking'

export function useVoiceDialogue(
  sendMessage: (content: string) => void,
  isStreaming: boolean,
  streamedContent: string,
  voiceId?: string,
) {
  const [phase, setPhase] = useState<VoiceDialoguePhase>('idle')
  const phaseRef = useRef<VoiceDialoguePhase>('idle')
  // ...
```

**ストリーミング完了の検知がキモ。** AIの応答はNDJSON ストリーミングで流れてくるので、`isStreaming` が `true → false` に変わった瞬間に Polly へ送る:

```typescript
// ストリーミング完了 → Polly で読み上げ
useEffect(() => {
  if (phaseRef.current !== 'processing' || isStreaming || !lastContent) return

  updatePhase('speaking')

  speakWithPolly(lastContent, voiceId)
    .then((audio) => {
      audio.addEventListener('ended', () => {
        // 再生終了 → 自動的にリスニングに戻る
        startListening()
      }, { once: true })

      audio.play()
    })
    .catch(() => {
      // TTS失敗時もリスニングに戻る（対話を止めない）
      startListening()
    })
}, [isStreaming])
```

### 5. 音声モード専用のシステムプロンプトを追加する

音声対話時はAIの応答を短くしないと、Polly の読み上げが長くなりすぎる。`voiceMode` フラグでプロンプトを切り替える:

```typescript
// amplify/functions/chat-handler/prompt.ts
${voiceMode ? `
## 音声対話モード（現在有効）
ユーザーは音声で対話しています。以下のルールを厳守してください：
- 回答は1〜2文で端的に答える
- 箇条書きや長い説明は避ける
- 質問は一度に1つだけ
- 「はい」「いいえ」で答えられる確認を優先する
- 記号や括弧の多用は避ける（音声読み上げに不向き）` : ''}
```

## ポイント・注意点

### Web Speech API の制約

- **Chrome/Edge のみ安定動作**。Safari は部分対応、Firefox は未対応
- `webkitSpeechRecognition` のプレフィックスが必要なブラウザがまだ多い
- HTTPS が必須（localhost は例外）
- マイク許可のダイアログが初回に表示される

### Polly のコストと制限

- Neural 音声: **$16.00 / 100万文字**（Standard は $4.00）
- 1リクエストの上限: **3,000文字**（Neural）
- 音声対話のAI応答は短く（100-300文字）に抑えるのがコスト面でも重要
- `voiceMode` プロンプトで応答長を制御するのはコスト最適化でもある

### ref で状態を追跡する理由

`useEffect` のクロージャ内では `useState` の最新値が見えない場合がある。フェーズの遷移は `useRef` で追跡し、状態表示用に `useState` も同期する:

```typescript
const phaseRef = useRef<VoiceDialoguePhase>('idle')

const updatePhase = useCallback((p: VoiceDialoguePhase) => {
  phaseRef.current = p
  setPhase(p)
}, [])
```

Audio の `ended` イベントハンドラ内で `phase` の最新値を参照するために、この ref パターンが必須。

### blob URL のメモリリーク防止

Polly から受け取った MP3 を `URL.createObjectURL` で Audio 要素に渡すが、再生後に `revokeObjectURL` しないとメモリリークする:

```typescript
audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
```

`{ once: true }` でリスナー自体も1回で自動削除される。

## まとめ

- **ユーザーの音声入力**: Web Speech API（`SpeechRecognition`）+ 2秒無音検知で自動送信
- **AIの音声出力**: Amazon Polly Neural（Lambda Function URL経由でMP3取得）
- **フェーズ制御**: `listening → processing → speaking → listening` の自動ループ
- **音声専用プロンプト**: `voiceMode` フラグでAIの応答を1-2文に制限
- 追加の音声モデル学習やサーバーは不要。ブラウザAPIとAWSマネージドサービスの組み合わせで実現可能
- **バイブコーディング**: 5ステップに分けてプロンプトを投げれば、AIコーディングツールで段階的に実装できる
