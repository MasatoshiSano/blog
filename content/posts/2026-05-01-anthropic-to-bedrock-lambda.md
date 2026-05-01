---
title: "Lambda の AI 呼び出しを Anthropic API から AWS Bedrock に乗り換える — @anthropic-ai/bedrock-sdk と jp.* inference profile"
icon: "bot"
type: "tech"
topics: ["AWS", "Bedrock", "Anthropic", "Lambda", "IAM"]
published: true
category: "HowTo"
date: "2026-05-01"
description: "Lambda 内で動く Claude 呼び出しを Anthropic API から AWS Bedrock 経由に切り替える具体的な手順。@anthropic-ai/bedrock-sdk で SDK 互換のまま、API キーを SSM から消し、IAM ロールだけで認証できるようにする。jp.anthropic.* inference profile と二段構えの IAM 権限の話も含む。"
coverImage: "/images/posts/2026-05-01-anthropic-to-bedrock-lambda-cover.webp"
---

## 概要

Lambda から Claude (Anthropic Claude Haiku 4.5) を呼ぶ実装を、`@anthropic-ai/sdk` (Anthropic API 直接) から `@anthropic-ai/bedrock-sdk` (AWS Bedrock 経由) に切り替えました。

メリット:

- **API キーを別途管理しなくてよくなる** (SSM `/blog/api/anthropic-key` を削除できた)
- 認証は **Lambda 実行ロールの IAM 権限だけ** に統一 (`bedrock:InvokeModel`)
- 課金が AWS の月次請求にまとまる
- リクエストデータを Japan 域内 (Tokyo + Osaka) に閉じる選択肢が取れる (`jp.anthropic.*` inference profile)

デメリット:

- Bedrock のモデル ID は `anthropic.claude-haiku-4-5-20251001-v1:0` のように冗長
- リージョンによってはまだ provision されていないモデルがある
- 初回利用時に Bedrock コンソールで「モデルアクセス」の有効化操作が必要 (アカウントによる)

切り替えの作業時間は実装 30 分 + テスト・デプロイ 30 分でした。

## SDK の差し替え

`@anthropic-ai/bedrock-sdk` は Anthropic 公式が出している **Anthropic SDK と API 互換のまま Bedrock を叩ける薄い wrapper** です。`messages.create({...})` のシグネチャもそのまま、`prompt caching` (`cache_control: ephemeral`) もそのまま使えます。

### ❌ 移行前

```ts
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";

let _factory = (apiKey: string) => new Anthropic({ apiKey });

export async function correctPostWithAi(markdown: string, apiKey: string) {
  const client = _factory(apiKey);
  return client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `次の md を補正:\n\n${markdown}` }],
  });
}
```

呼び出し側は `apiKey` を SSM から取得して渡す必要がありました。

### ✅ 移行後

```ts
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

// JP cross-region inference profile (Tokyo + Osaka 内で routing、データ越境なし)
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "jp.anthropic.claude-haiku-4-5-20251001-v1:0";

let _factory = () => new AnthropicBedrock();  // AWS 認証情報は env から自動取得

export async function correctPostWithAi(markdown: string) {
  const client = _factory();
  return client.messages.create({
    model: MODEL_ID,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `次の md を補正:\n\n${markdown}` }],
  });
}
```

差分は実質 3 行です:

- `import` を `@anthropic-ai/sdk` → `@anthropic-ai/bedrock-sdk`
- `new Anthropic({ apiKey })` → `new AnthropicBedrock()` (AWS 環境では Lambda 実行ロールの credentials を SDK が自動取得)
- model ID を Bedrock 形式に変更

`messages.create` の引数や戻り値は **完全に同一**。`prompt caching` も Bedrock がネイティブ対応しているのでそのまま動きます。

## モデル ID の選び方

Bedrock の Claude モデルは 3 通りの ID 体系があります:

| 種類 | 例 | 用途 |
|------|-----|------|
| Foundation Model (region 固定) | `anthropic.claude-haiku-4-5-20251001-v1:0` | 単一リージョンで完結する場合 |
| Inference Profile (cross-region) | `jp.anthropic.claude-haiku-4-5-20251001-v1:0` | `jp.*` (日本) `us.*` (米) `eu.*` (欧) `apac.*` (アジア太平洋) `global.*` (全世界) |
| Custom Inference Profile | (アカウントで作成) | 独自の routing/コスト配分 |

**個人ブログ + Tokyo (`ap-northeast-1`) で使う場合は `jp.anthropic.*` 推奨**。理由:

- リクエストデータが Japan 域 (Tokyo + Osaka) を出ない (compliance 観点で安心)
- 単一 region がスロットリングしても自動で他 region にフェイルオーバー
- レイテンシ的にも `global.*` より明確に近い

確認方法:

```bash
aws bedrock list-foundation-models --region ap-northeast-1 \
  --query "modelSummaries[?contains(modelId, 'haiku-4-5')].[modelId, modelLifecycle.status]" \
  --output table

aws bedrock list-inference-profiles --region ap-northeast-1 \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'haiku-4-5')].[inferenceProfileId, status]" \
  --output table
```

`jp.anthropic.claude-haiku-4-5-20251001-v1:0` が `ACTIVE` で表示されれば利用可。`global.anthropic.*` も同時に並ぶことが多いです。

## IAM 権限は二段構え

Bedrock を inference profile 経由で叩く場合、IAM 権限は **profile 自身 と 配下の foundation model の両方** に必要です (AWS 公式仕様)。1 つだけだと `AccessDenied` になります。

### ✅ CDK で書く場合

```ts
apiHandler.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    resources: [
      // Inference profile (cross-region routing)
      `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/jp.anthropic.claude-haiku-4-5-*`,
      // 配下の foundation model (各 region の実体)
      `arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*`,
    ],
  })
);
```

ポイント:

- inference profile の ARN は `${this.account}` をスコープ (アカウント所有のリソース)
- foundation model の ARN は `*::` (region 全許可、`account` は空文字) — JP profile が背後で他 region のモデルにフェイルオーバーするので、`ap-northeast-1` 限定にするとエラーになる
- ワイルドカード `claude-haiku-4-5-*` を使うとモデルバージョン違い (-v1:0, -v2:0 等) も同じポリシーで吸収できる

### Bedrock のモデルアクセス有効化 (一度だけ)

新規アカウントだと、Bedrock コンソールで「Model access」を一度開いて Anthropic 系モデルへのアクセスを有効化する必要があります。CLI で確認できる方法:

```bash
aws bedrock-runtime invoke-model --region ap-northeast-1 \
  --model-id "jp.anthropic.claude-haiku-4-5-20251001-v1:0" \
  --cli-binary-format raw-in-base64-out \
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":50,"messages":[{"role":"user","content":"hi"}]}' \
  /tmp/test-out.json && cat /tmp/test-out.json
```

`{"content":[{"type":"text","text":"Hi! ..."}], ...}` が返ればアクセス OK。`AccessDeniedException` ならコンソールで有効化が必要です。

## Lambda 環境変数の整理

`@anthropic-ai/sdk` 時代は SSM から API キーを cold-start で取得していました。Bedrock 経由になったので **このパラメータは不要**。

| パラメータ | 状態 |
|-----------|------|
| `/blog/api/anthropic-key` | **削除** |
| `/blog/api/jwt-secret` | 維持 |
| `/blog/api/admin-password-hash` | 維持 |
| `/blog/api/api-key-hash` | 維持 |
| `/blog/api/github-dispatch-token` | 維持 |

`loadApiSecrets` の `Promise.all` から該当の `getParameter` を消すだけで OK。

```bash
aws ssm delete-parameter --region ap-northeast-1 --name /blog/api/anthropic-key
```

## バンドルサイズの差

esbuild で `--external:@aws-sdk/*` を指定したまま bundle すると:

| SDK | dist サイズ |
|------|-----------|
| `@anthropic-ai/sdk` | 226.8 KB |
| `@anthropic-ai/bedrock-sdk` | 348.6 KB |

差分は約 120 KB。Bedrock SDK は AWS Signature V4 + Smithy runtime を内包するためです。Lambda の zip 上限 50MB から見ると微々たるものです。

## バイブコーディングで実装する

AI コーディングアシスタントに頼むときの指示例:

```
Lambda の AI 呼び出しを Anthropic API から AWS Bedrock に切り替えてほしい。
要件:

- @anthropic-ai/sdk → @anthropic-ai/bedrock-sdk に置換
- new Anthropic({ apiKey }) → new AnthropicBedrock() に変更 (AWS 環境では SDK が
  Lambda 実行ロールの credentials を自動取得する)
- model ID は env BEDROCK_MODEL_ID で override 可、デフォルトは
  "jp.anthropic.claude-haiku-4-5-20251001-v1:0" (JP cross-region inference profile)
- prompt caching (cache_control: ephemeral) は Bedrock も対応しているのでそのまま
- SSM の anthropic-key パラメータは loadApiSecrets から削除し、ApiSecrets 型から
  anthropicKey フィールドを除去
- IAM: Lambda 実行ロールに bedrock:InvokeModel 権限を付与する。resources は
  inference profile ARN (アカウント所有) と foundation model ARN (region ワイルド
  カード) の両方を含める。両方ないと AccessDenied になる
- esbuild bundle で --external:@aws-sdk/* を維持 (Lambda runtime に同梱されるため)

api/ ディレクトリ配下の SDK 移行が中心。テストは AWS SDK のモックパターンを
踏襲すれば OK (aws-sdk-client-mock + Anthropic factory injection)。
```

## まとめ

`@anthropic-ai/sdk` から `@anthropic-ai/bedrock-sdk` への移行は、SDK 互換のおかげで **3 行程度のコード変更で完了** します。それに加えて IAM 権限の二段構え (inference profile + foundation model) と、`jp.*` inference profile の選択がポイント。Anthropic API キーを別管理する手間が消え、`bedrock:InvokeModel` の IAM ロールで全部済むので、Lambda の secrets 管理が一段シンプルになりました。
