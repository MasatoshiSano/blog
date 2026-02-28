---
title: "ベクターDB無しでRAGを最短実装する — DynamoDB GSIだけで始めるAI知識活用"
emoji: "🧠"
type: "tech"
topics: ["DynamoDB", "RAG", "AWS", "Bedrock", "TypeScript", "Search"]
published: true
category: "Architecture"
date: "2026-02-27"
description: "ベクターDBを使わず、DynamoDBのGSI（Global Secondary Index）だけでRAGを実装した方法。Amplify Gen 2 + Bedrock Claude環境で、過去の保存データをAIプロンプトに注入するパターンを紹介。"
---

## 概要

AIチャットに「過去の事例を参照して回答する」RAG（Retrieval-Augmented Generation）機能を追加したい。しかし、OpenSearch や Pinecone のようなベクターDBを導入するのは、コストもインフラ管理も重い。

本記事では、**DynamoDBのGSIだけで実用的なRAGを実現する方法**を紹介する。ベクターDBなしで「まず動く RAG」を最短で立ち上げたいケースに有効。

### 読者が得られるもの

- DynamoDB GSI を使った過去データ取得パターン
- 取得データを Bedrock Claude のシステムプロンプトに注入する設計
- Lambda でのメッセージ取得と RAG クエリの並列実行による低レイテンシ化

## こんな人向け

- RAGを導入したいが、OpenSearchやPineconeなどベクターDBの運用コストが気になる
- DynamoDBだけで「まず動くRAG」を最短で立ち上げたい
- Amplify Gen 2 + Bedrock環境で過去データをAIに参照させたい

## 前提条件

- AWS Amplify Gen 2（AppSync + DynamoDB + Lambda）
- Amazon Bedrock（Claude Sonnet）
- TypeScript / Node.js Lambda

## アーキテクチャ

```text
ユーザー → Lambda (Function URL)
              ├── getMessages(sessionId)     ─┐
              │                                ├── Promise.all（並列実行）
              └── queryPastCases(themeId)    ─┘
                        │
                        ▼
              buildSystemPrompt(theme, fields, data, voiceMode, pastCases)
                        │
                        ▼
              Bedrock Claude → ストリーミング応答
```

ポイントは、チャット履歴の取得と RAG クエリを `Promise.all` で並列実行すること。RAG のために追加されるレイテンシをほぼゼロに抑えられる。

## 手順

### 1. DynamoDB スキーマに GSI を定義する

Amplify Gen 2 の `defineData` でモデルを定義する際、`secondaryIndexes` に **themeId + createdAt** の複合インデックスを設定する。

```typescript
// amplify/data/resource.ts
SavedData: a
  .model({
    themeId: a.string().required(),
    title: a.string().required(),
    content: a.json().required(),
    isDeleted: a.boolean().default(false),
    createdAt: a.datetime(),
    // ... 他のフィールド
  })
  .secondaryIndexes((index) => [
    index('themeId').sortKeys(['createdAt']),  // ← これがRAG用GSI
  ]),
```

Amplify が自動生成するGSI名は `savedDataByThemeIdAndCreatedAt`。パーティションキーが `themeId`、ソートキーが `createdAt` なので、「あるテーマの過去データを新しい順に取得」が1クエリで実現できる。

### 2. Lambda から GSI をクエリする関数を作る

```typescript
// amplify/functions/streaming-chat/handler.ts

interface PastCase {
  title: string
  content: Record<string, string>
  createdAt: string
}

async function queryPastCases(themeId: string): Promise<PastCase[]> {
  const tableName = process.env.SAVEDDATA_TABLE_NAME
  if (!tableName) return []  // 環境変数未設定時はフォールバック

  const { Items } = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'savedDataByThemeIdAndCreatedAt',
      KeyConditionExpression: 'themeId = :tid',
      ExpressionAttributeValues: { ':tid': themeId },
      ScanIndexForward: false, // 新しい順
      Limit: 20,
    }),
  )

  return (Items ?? [])
    .filter((item) => !item['isDeleted'])  // 論理削除を除外
    .slice(0, 10)                          // 最大10件に絞る
    .map((item) => ({
      title: (item['title'] as string) ?? '',
      content: typeof item['content'] === 'string'
        ? JSON.parse(item['content'])
        : item['content'] as Record<string, string>,
      createdAt: (item['createdAt'] as string) ?? '',
    }))
}
```

**設計判断**:
- `Limit: 20` で取得し、`isDeleted` フィルタ後に `slice(0, 10)` で最大10件。20件取得するのは、論理削除レコードが混在する可能性があるため
- `ScanIndexForward: false` で新しいデータから取得。古い事例より直近の事例のほうが参照価値が高い

### 3. メッセージ取得と並列実行する

RAG クエリは既存のチャット履歴取得と独立しているので、`Promise.all` で並列実行する。

```typescript
// handler.ts — メインハンドラ内
const [messages, pastCases] = await Promise.all([
  getMessages(sessionId),
  queryPastCases(session.themeId),
])
```

これにより、RAG 追加前と比べてレイテンシの増加はほぼゼロ。DynamoDB GSI クエリは通常 10ms 以下で完了するため、チャット履歴クエリ（数十ms）の裏で完了する。

### 4. システムプロンプトに過去事例を注入する

取得した過去事例をフォーマットしてシステムプロンプトに埋め込む。

```typescript
// amplify/functions/chat-handler/prompt.ts

function formatPastCases(cases: PastCase[]): string {
  return cases
    .map((c, i) => {
      const fields = Object.entries(c.content)
        .map(([key, val]) => `  - ${key}: ${val}`)
        .join('\n')
      return `### 事例${i + 1}: ${c.title}（${c.createdAt.slice(0, 10)}）\n${fields}`
    })
    .join('\n\n')
}

export function buildSystemPrompt(
  themeName: string,
  fields: ThemeField[],
  existingData: Record<string, string | null>,
  voiceMode = false,
  pastCases: PastCase[] = [],
): string {
  return `あなたは製造現場の情報収集を支援するAIアシスタントです。
...

## 過去の事例データ（ナレッジベース）:
${pastCases.length > 0 ? formatPastCases(pastCases) : '（過去の事例データはまだありません）'}

## ナレッジ活用ガイドライン:
- ユーザーの報告内容に類似する過去事例がある場合、参考として言及してください
- 「過去にも同様の事例がありました：[事例のタイトル]」のように自然に共有
- 過去事例の対処内容や原因を参考情報として提供
- ただし過去事例は参考であり、現在の状況を優先すること
- ユーザーが明示的に「過去の事例は？」と聞いた場合は詳細に回答
...`
}
```

### 5. Lambda に DynamoDB テーブルへのアクセス権を付与する

Amplify Gen 2 の `defineBackend` で、Lambda がSavedDataテーブルを読めるように環境変数とIAMポリシーを設定する。

```typescript
// amplify/backend.ts
const tableMapping: Record<string, string> = {
  CHATSESSION_TABLE_NAME: 'ChatSession',
  CHATMESSAGE_TABLE_NAME: 'ChatMessage',
  SAVEDDATA_TABLE_NAME: 'SavedData',  // ← RAG用に追加
  // ...
}

for (const [envKey, modelName] of Object.entries(tableMapping)) {
  const table = tables[modelName]
  chatLambda.addEnvironment(envKey, table.tableName)
  table.grantReadWriteData(chatLambda)

  // GSI へのアクセスも明示的に許可
  chatLambda.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:Query', 'dynamodb:Scan'],
      resources: [`${table.tableArn}/index/*`],
    }),
  )
}
```

## ポイント・注意点

### なぜベクターDBを使わないのか

| 観点 | ベクターDB（OpenSearch等） | DynamoDB GSI |
|------|--------------------------|-------------|
| コスト | 月$50〜$500+ | 既存テーブルのGSI追加のみ（ほぼ無料） |
| レイテンシ | 50-200ms | 5-15ms |
| セマンティック検索 | ✅ 意味的類似度で検索 | ❌ themeId完全一致のみ |
| インフラ管理 | クラスター管理、スケーリング | 不要（サーバーレス） |
| 導入工数 | Embedding生成パイプライン構築 | GSI定義 + クエリ関数のみ |

**トレードオフ**: セマンティック検索ができない代わりに、同一テーマ（= 同じ報告カテゴリ）の過去事例を時系列で取得する。製造現場のトラブル報告では「同じ設備カテゴリの過去トラブル」が最も参考になるため、themeId ベースの検索で実用上十分。

### スケーラビリティの限界

- 1テーマあたり数千件程度までは問題ない
- 件数が増えたら、`FilterExpression` や `createdAt` のレンジ指定で直近N日に絞る
- 将来的にセマンティック検索が必要になったら、Bedrock Knowledge Bases に移行する拡張パスがある

### プロンプトサイズに注意

10件の過去事例をそのままプロンプトに入れると、トークン数が増えてコストに影響する。対策:

- 件数上限を設ける（今回は10件）
- 各事例のフィールドを要約する（長文フィールドは先頭N文字に切り詰める）
- Bedrock の `max_tokens` を適切に設定する

## まとめ

- DynamoDB の GSI（themeId + createdAt）だけで、実用的な RAG を最短で実装できる
- `Promise.all` による並列実行で、RAG 追加のレイテンシ増加はほぼゼロ
- システムプロンプトに「ナレッジベース」セクションと「活用ガイドライン」を追加するだけで、AIが自然に過去事例を参照する
- ベクターDB は「必要になってから」導入すればよい。まずは GSI ベースで出荷し、フィードバックを得てから判断する
