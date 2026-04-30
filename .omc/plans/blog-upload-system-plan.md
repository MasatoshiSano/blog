# ブログ記事アップロードシステム 実装計画

最終更新: 2026-04-30

## Requirements Summary

ブログ (`content/posts/*.md` を git 管理する Next.js 静的エクスポート) に、認証付きの記事アップロード機能を追加する。Web UI と REST API を提供し、API はローカル MCP サーバ経由で任意のプロジェクトの Claude Code から呼び出せるようにする。AI でフロントマター補完と本文構造補正、サムネ未指定時の Unsplash フォールバックを行う。

### 確定済み要件 (ヒアリング結果)

| # | 項目 | 決定内容 |
|---|------|---------|
| 1 | 記事の保存先 | S3 直接配置 (新規 `contentBucket`) |
| 2 | 公開反映方式 | アップロード → S3 保存 → GitHub Actions 再ビルド (1〜3 分遅延) |
| 3 | AI 補正スコープ | frontmatter 補完 + 本文構造補正 (見出しレベル正規化、コードブロック言語推定、`:::note` 正規化など)。文体校正は対象外 |
| 4 | AI フロー | プレビュー&確定の二段階 (Web UI: 確認画面、API/MCP: `preview` と `publish` の 2 ツール) |
| 5 | 認証方式 | 軽量 JWT (Web UI、HttpOnly Cookie) + API キー HMAC (API/MCP)。シークレットは AWS Parameter Store (SecureString) |
| 6 | 配信形態 | REST API (Lambda + API Gateway) + ローカル MCP サーバ (npx で配布) |
| 7 | アイコン | `emoji: "🖥️"` を廃止し `icon: "monitor"` (Lucide 名) に置換。色付き絵文字は使わない |
| 8 | サムネ画像 | 任意アップロード。未指定時は Unsplash プール (`src/data/unsplash-images.json`) から slug ハッシュで決定論的選択 |
| 9 | category/topics 自動生成 | 未指定時、AI が本文から推定して候補を生成 (確定はプレビュー画面で人間が承認) |

### デフォルトとして採用 (レビューで押し戻し可)

| # | 項目 | 既定値 | 理由 |
|---|------|-------|------|
| D1 | MCP サーバ言語 | TypeScript (`@modelcontextprotocol/sdk`) | ブログ本体と統一、`npx` 配布が容易 |
| D2 | Web UI 配置 | ブログ本体の `/admin/*` ルート | 既存 Next.js プロジェクト内で完結、静的エクスポートのまま (認証チェックは API ガード) |
| D3 | 画像アップロード | Pre-signed URL でブラウザから S3 直接 PUT | Lambda 経由不要、リサイズ・WebP 変換は将来課題 |
| D4 | ビルドトリガー | GitHub Actions `repository_dispatch` | 既存 `.github/workflows/deploy.yml` と統一、追加サービス不要 |
| D5 | AI モデル | Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | frontmatter / 構造補正は Haiku で十分、コスト最小 |
| D6 | リージョン | `ap-northeast-1` | 既存 CDK と統一 |
| D7 | Unsplash 取得 | 既存 `unsplash-images.json` 継続利用、`scripts/fetch-unsplash.mjs` を月次手動実行 | 現行ロジック (`src/lib/unsplash.ts`) を流用、API レート上限を実質回避 |

## Acceptance Criteria

| ID | 受け入れ基準 | 検証方法 |
|----|------------|---------|
| AC-01 | 認可済みユーザーが Web UI から md ファイル + (任意) サムネ画像を選択し、AI 補正後のプレビューを確認・編集して公開できる | E2E (Playwright): ログイン → アップロード → プレビュー編集 → 公開 → 1〜3 分後に `/posts/<slug>` に表示 |
| AC-02 | 任意プロジェクトディレクトリの Claude Code から MCP ツール `blog_preview_post` で AI 補正結果を取得し、`blog_publish_post` で公開できる | 手動: 別リポジトリの Claude Code セッションで MCP 経由アップロード → 公開確認 |
| AC-03 | API キーの HMAC 検証に失敗したリクエストは `401 Unauthorized` を返し、本文を保存しない | Lambda ユニットテスト + curl 統合テスト |
| AC-04 | JWT トークン未提示・無効・期限切れの Web UI リクエストは `/admin/login` にリダイレクト | E2E |
| AC-05 | frontmatter が不完全な md (例: `topics` 欠落) をアップロードすると、プレビュー画面で AI が補完した値を提示する | Lambda ユニットテスト (Anthropic SDK は VCR/モック)、E2E (本物の API で 1 ケース) |
| AC-06 | サムネを指定しなかった場合、プレビュー画面に Unsplash から決定論的に選ばれた画像が表示される | E2E + ユニットテスト (`getUnsplashImageForSlug` の挙動確認) |
| AC-07 | 既存 9 記事の `emoji` フィールドが Lucide アイコン名に移行され、ビルド成功・記事カードに対応アイコンが表示される | `npm run build` 成功、視覚確認 (各カードのアイコン) |
| AC-08 | `tsc --noEmit` と `npm test` が全パス、`next lint` が警告なし | CI |
| AC-09 | CDK 変更を `cdk diff` で確認後 `cdk deploy` が成功し、`SiteBucketName`、`MediaBucketName`、`ContentBucketName`、`ApiEndpoint`、`DistributionId` が出力される | デプロイ後の CloudFormation Outputs |

## Architecture Overview

```
[ブラウザ / Claude Code (MCP)]
         │
         ▼
   API Gateway (REST)
         │
         ▼
   Lambda Functions
         ├── auth (login / verify)
         ├── posts (preview / publish / list / delete)
         └── images (presign upload URL)
         │
         ├──► Anthropic Claude API (補正)
         ├──► Parameter Store (シークレット)
         ├──► S3: contentBucket (md 永続化)
         ├──► S3: mediaBucket (画像)
         └──► GitHub repository_dispatch (再ビルド発火)

[GitHub Actions on main]
   1. checkout
   2. aws s3 sync s3://contentBucket/posts/ content/posts/
   3. aws s3 sync s3://mediaBucket/ public/media/
   4. npm run build
   5. aws s3 sync out/ s3://siteBucket/ --delete
   6. cloudfront create-invalidation
```

## Implementation Steps

### Phase 1: インフラ拡張 (CDK)

**`infra/lib/blog-stack.ts`** (既存ファイル更新):

1. `contentBucket` を追加 (Markdown 専用 S3)
   - `BlockPublicAccess.BLOCK_ALL`、`BucketEncryption.S3_MANAGED`
   - バージョニング有効化 (誤上書き対策)
2. `mediaBucket` の用途を「画像アップロード受け先」として確定
   - CORS ルールを追加 (`/admin/*` からの PUT 許可、配信ドメインからの GET 許可)
3. Lambda Function (`apiHandler`) を追加 — Node.js 20 ランタイム、ハンドラは `api/dist/index.handler`
   - 環境変数: `CONTENT_BUCKET`、`MEDIA_BUCKET`、`PARAMETER_STORE_PREFIX`、`GITHUB_DISPATCH_REPO`、`AWS_REGION`
   - IAM: `s3:PutObject`/`s3:GetObject` (content + media)、`ssm:GetParameter` (`/blog/api/*`)、`logs:*`
4. API Gateway REST API を追加
   - エンドポイント:
     - `POST /admin/login`
     - `POST /admin/posts/preview` (md + 画像メタ → AI 補正後の JSON)
     - `POST /admin/posts/publish` (確定 JSON → S3 + ビルド発火)
     - `GET  /admin/posts` (一覧)
     - `DELETE /admin/posts/{slug}`
     - `POST /admin/images/upload-url` (pre-signed PUT URL 発行)
   - CORS は `/admin/*` のみ、ブログドメイン許可
5. CloudFront に新しい behavior を追加 (`/api/*` → API Gateway origin) ※ Web UI から同一オリジンで叩けるようにする
6. SSM Parameter Store パラメータの宣言:
   - `/blog/api/admin-password-hash` (Argon2id)
   - `/blog/api/jwt-secret`
   - `/blog/api/api-key-hash` (HMAC 検証用、複数エントリ対応)
   - `/blog/api/anthropic-key`
   - `/blog/api/github-dispatch-token`
7. CfnOutput に `ContentBucketName`、`ApiEndpoint` を追加

**`infra/bin/blog.ts`**: 新パラメータが必要なら `props` 経由で渡す

**ファイル参照**: `infra/lib/blog-stack.ts:7-116` を拡張

### Phase 2: API Lambda 実装

新規ディレクトリ **`api/`** を作成 (`infra/` と同様にルート直下、独立 package)

```
api/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # エントリ (API Gateway proxy event ルーター)
│   ├── routes/
│   │   ├── login.ts
│   │   ├── posts.ts        # preview / publish / list / delete
│   │   └── images.ts       # presign
│   ├── auth/
│   │   ├── jwt.ts
│   │   ├── apiKey.ts       # HMAC 検証
│   │   └── middleware.ts
│   ├── ai/
│   │   ├── client.ts       # Anthropic SDK ラッパー (prompt caching 有効)
│   │   ├── prompts.ts      # frontmatter 補完 / 構造補正のシステムプロンプト
│   │   └── validate.ts     # PostFrontmatter スキーマ検証 (zod)
│   ├── unsplash.ts         # ブログの src/lib/unsplash.ts と同等のロジック
│   ├── github.ts           # repository_dispatch 発火
│   ├── s3.ts               # putObject / getSignedUrl
│   └── ssm.ts              # Parameter Store 読み取り (cold start 時のみ)
└── tests/
    └── *.test.ts
```

**主要実装ポイント:**

- `auth/jwt.ts`: HS256、有効期限 24h、HttpOnly Cookie 発行
- `auth/apiKey.ts`: ヘッダ `Authorization: Bearer <api-key>`、Parameter Store 上のハッシュ群と timing-safe 比較
- `ai/client.ts`: Anthropic SDK + **prompt caching を有効化** (システムプロンプトを `cache_control: ephemeral` でキャッシュ) → コスト削減
- `ai/prompts.ts`: スキーマ (zod で表現した PostFrontmatter) をシステムプロンプトに埋め込み、JSON モードで返答させる
  - Lucide のアイコン名候補リスト (~200 個程度に絞る) をプロンプトに含めて、AI が `icon` フィールドにそこから 1 つ選ぶ
- `routes/posts.ts:preview`:
  1. md パース (gray-matter)
  2. zod でフロントマター検証
  3. 不足フィールドがあれば AI に補完依頼 + 構造補正の差分を返す
  4. `icon` 未指定なら Lucide 候補 + AI 推定値を返す
  5. `coverImage` 未指定なら Unsplash プールから決定論的選択 (slug 仮値で先計算)
  6. レスポンス: 元の md + 補正後の md + frontmatter 差分 + Unsplash プレビュー URL
- `routes/posts.ts:publish`:
  1. zod 厳格検証 (補正済み JSON は必ず完全フォーム)
  2. S3 `s3://contentBucket/posts/<slug>.md` に PUT
  3. GitHub `POST /repos/{owner}/{repo}/dispatches` に `event_type: "blog-rebuild"` 発火
  4. レスポンス: `{ slug, deployingAt, estimatedReady: "1-3 minutes" }`
- `routes/images.ts:presign`: AWS SDK v3 の `getSignedUrl` で 5 分有効な PUT URL を返す。キーは `media/uploads/<uuid>.<ext>`
- テスト: vitest、Anthropic SDK は MSW ベースのモック、AWS SDK は `aws-sdk-client-mock`

### Phase 3: ブログ本体改修

**型定義** (`src/types/post.ts`):
- `emoji: string` を削除
- `icon: string` を追加 (Lucide アイコン名)
- マイグレーション期間用にしばらく `emoji?: string` を optional で残す (削除は次の PR)

**Markdown コンテンツの取得経路** (`src/lib/posts.ts`):
- 現行は `process.cwd()/content/posts` をスキャン
- ビルド時に `content/posts` に S3 contentBucket の中身が同期されている前提を追加 (deploy.yml で対応)
- ローカル開発時は git の `content/posts` のみ参照する従来通りの動作

**コンポーネント更新**:
- `src/components/articles/ArticleCard.tsx` `HeroSection.tsx` `ArticleDetail.tsx` で `emoji` を表示している箇所を Lucide コンポーネント (`<Icon name={post.icon} />`) に置換
- `lucide-react` を依存追加
- アイコン未指定 (旧記事マイグレーション漏れ) の場合のフォールバックは `FileText` 等

**既存記事マイグレーション**:
- スクリプト `scripts/migrate-emoji-to-icon.mjs` を作成
  - `content/posts/*.md` を読み込み、`emoji` から最尤の Lucide アイコン名を AI で推定
  - 結果を frontmatter の `icon` として書き込み、`emoji` は削除
- 単発実行 (`node scripts/migrate-emoji-to-icon.mjs`)、結果を人間レビュー後コミット
- 9 記事のマイグレーション結果を PR で確認

**新規ルート**:
- `src/app/admin/login/page.tsx` — ログインフォーム (静的エクスポート互換、Server Component なし、Client Component でフォーム)
- `src/app/admin/upload/page.tsx` — アップロード UI (md ファイル選択、画像選択、プレビュー、編集、公開ボタン)
- `src/app/admin/posts/page.tsx` — 記事一覧・編集・削除 (任意、後回し可)

**API クライアント** (`src/lib/admin-api.ts`):
- `fetch` ベースの簡易クライアント (Cookie 経由で認証)
- 関数: `login(password)` / `previewPost(md, imageMeta?)` / `publishPost(payload)` / `getUploadUrl(filename)`

### Phase 4: MCP サーバ実装

新規ディレクトリ **`mcp-blog/`** (root 直下、独立 package、将来 `npm publish` 可能な構成):

```
mcp-blog/
├── package.json    # bin: mcp-blog
├── README.md
├── tsconfig.json
├── src/
│   ├── index.ts    # MCP server エントリ (stdio transport)
│   ├── tools.ts    # blog_preview_post / blog_publish_post / blog_list_posts / blog_delete_post
│   ├── client.ts   # REST API クライアント (fetch + API key ヘッダ)
│   └── schema.ts   # ツール入出力の zod スキーマ
└── tests/
```

**MCP ツール定義**:

| ツール名 | 入力 | 出力 |
|---------|------|------|
| `blog_preview_post` | `markdown: string`、`imagePath?: string` | 補正後 frontmatter + 補正後 md + Unsplash 候補 URL |
| `blog_publish_post` | `markdown: string` (補正済み)、`imagePath?: string` | `{ slug, deployingAt }` |
| `blog_list_posts` | `published?: boolean`、`limit?: number` | `[{slug, title, date, category}]` |
| `blog_delete_post` | `slug: string` | `{ deleted: slug, deployingAt }` |

**設定方法ドキュメント** (README.md):
```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "blog": {
      "command": "npx",
      "args": ["-y", "mcp-blog@latest"],
      "env": {
        "BLOG_API_ENDPOINT": "https://blog.example.com/api",
        "BLOG_API_KEY": "..."
      }
    }
  }
}
```

### Phase 5: GitHub Actions 改修

**`.github/workflows/deploy.yml`** 更新:
1. トリガーに `repository_dispatch` (`types: [blog-rebuild]`) を追加
2. ビルド前に S3 同期ステップを追加:
   ```yaml
   - name: Sync content from S3
     run: |
       aws s3 sync "s3://${CONTENT_BUCKET}/posts/" content/posts/ --delete
       aws s3 sync "s3://${MEDIA_BUCKET}/" public/media/ --delete
   ```
3. AWS 認証 step は既存のまま (OIDC)

### Phase 6: 検証 & ドキュメント

- `CLAUDE.md` を更新 (新しい `/admin` ルート、`api/`、`mcp-blog/` 構成、AI 補正の前処理について追記)
- `README.md` (もしあれば) に運用手順
- `mcp-blog/README.md` に Claude Code への登録手順
- ローカル開発: `api/` に Lambda ローカル実行スクリプト (sam local or wrangler 風)、`mcp-blog/` に開発時用 mock client

## Risks and Mitigations

| ID | リスク | 影響 | 緩和策 |
|----|-------|------|--------|
| R-01 | API キーの漏洩 (Claude Code 設定ファイル流出) | 不正な記事公開・削除 | キーローテーション機能を Parameter Store で複数エントリ運用、漏洩時はキー削除で即無効化 |
| R-02 | JWT secret 漏洩 (Lambda env 経由) | Web UI 不正ログイン | Parameter Store の SecureString、定期ローテーション (3 ヶ月)、cold start 時のみ取得 |
| R-03 | AI 補正結果が意図と異なる | 記事内容の意図しない改変 | 二段階フロー (プレビュー → 確定) で人間が承認、`publish` API は補正前 md も保持 (S3 versioning) |
| R-04 | ビルド失敗で新記事が反映されない | アップロード成功表示 vs 実際は未公開 | `publish` レスポンスでビルド ID を返し、ステータス確認用 `GET /admin/posts/{slug}/status` を提供。GHA に Slack 通知も追加 |
| R-05 | S3 contentBucket と git `content/posts/` の不整合 (drift) | ローカルビルドと本番ビルドで内容差異 | デプロイ workflow が S3 → `content/posts/` へ常に sync (single source of truth は S3)、git 直編集は管理者のみ・最終的に S3 へ反映する運用ルール |
| R-06 | Lucide アイコン名の自動推定が外す | 記事カードのアイコンが意図と違う | プレビュー画面でアイコン候補を 5 つ提示・選択可能、既存記事マイグレーションは PR レビュー必須 |
| R-07 | Anthropic API レート / コスト | コスト膨張、レート上限 | prompt caching 有効化、Haiku 4.5 採用、月次予算アラート設定、`preview` 結果のクライアント側キャッシュ |
| R-08 | サムネ画像が大きすぎて配信遅延 | 体感速度劣化 | 初版はサイズチェック (10MB 上限) のみ、リサイズ・WebP 化は将来課題として README に記載 |
| R-09 | 静的エクスポートが API Gateway behavior と衝突 | `/api/*` パスが Next.js のルーティングと干渉 | CloudFront behavior の優先順位で `/api/*` を独立配信、Next.js 側に `/api/` ルートを作らない |
| R-10 | MCP サーバの初回配布 | `npx` で起動できない | MCP プロジェクトは Phase 4 で開発のみ行い、初期は GitHub からの直接インストール (`"command": "npx", "args": ["-y", "github:user/mcp-blog"]`)、安定後 npm 公開 |
| R-11 | 認証回避バイパス | 不正アクセス | 全 `/admin/*` Lambda エンドポイントの先頭に共通ミドルウェア、ユニットテストで「認証ヘッダ無し → 401」を網羅 |

## Verification Steps

1. **インフラ**:
   - `cd infra && npx cdk diff` で差分確認
   - `npx cdk deploy` 成功、Outputs に新パラメータ表示
   - AWS Console で Lambda、API Gateway、Parameter Store 各リソースの存在確認

2. **API ユニットテスト**:
   - `cd api && npm test` で全パス
   - JWT 検証 / API キー検証 / preview / publish の主要パスをカバー

3. **Web UI E2E**:
   - `npm run build` で `/admin/login` `/admin/upload` がエクスポートされること
   - Playwright (新規導入) で: ログイン → md アップロード → プレビュー編集 → 公開 → 1〜3 分後に `/posts/<slug>` に表示

4. **MCP**:
   - `cd mcp-blog && npm run build` 成功
   - `~/.claude/settings.json` にローカルパスで登録 → 別プロジェクトの Claude Code から `blog_preview_post` ツール実行 → 補正結果取得
   - `blog_publish_post` でテスト記事 (タイトル先頭 `[TEST]`) を公開 → 反映確認 → `blog_delete_post` で削除

5. **既存機能のリグレッション**:
   - `npm test` (vitest) 全パス
   - `npm run build` 成功
   - `npm run lint` 警告なし
   - 既存 9 記事が新しい Lucide アイコンで表示される (視覚確認)
   - フィード `/feed.xml` が引き続き有効
   - カテゴリ・タグページが正しくページネーション

6. **セキュリティ**:
   - `curl -X POST <api>/admin/posts/publish -d '{"slug":"hack"}'` (認証ヘッダ無し) → 401
   - 不正な API キー → 401
   - 期限切れ JWT → 401
   - ペイロードのスラグに `../` を含む → 400 (path traversal 対策)

## 段階的リリース推奨順序

| 段階 | 内容 | リリース可能? |
|------|------|------------|
| 1 | Phase 1 + 2 (インフラ + API、Web UI なし) | YES — curl で動作確認 |
| 2 | Phase 5 (GHA 改修) と Phase 1 のビルドトリガー疎通 | YES — 手動 dispatch でビルド |
| 3 | Phase 3 のうち型定義 + Lucide 移行のみ | YES — 既存 9 記事のアイコン化のみ |
| 4 | Phase 3 残り (Web UI) | YES — 管理者ログインから初の記事公開 |
| 5 | Phase 4 (MCP サーバ) | YES — Claude Code から投稿可能 |
| 6 | Phase 6 (ドキュメント整備) | 並行可能 |

## Confirmed Configuration (ヒアリング第二ラウンド結果)

| ID | 項目 | 決定内容 |
|----|------|---------|
| C1 | ドメイン | CloudFront デフォルト (`https://dxbqlfvrescw1.cloudfront.net/`) を継続使用。Route53 / ACM 設定は対象外。Web UI と API は同一オリジンで提供 (CloudFront `/api/*` behavior → API Gateway origin)。これにより CORS 設定は最小限 (画像 PUT 用の S3 CORS のみ) |
| C2 | 初期パスワード設定 | `scripts/set-admin-password.mjs` で対話的に設定。Argon2id ハッシュ化後に Parameter Store (`/blog/api/admin-password-hash`) へ PUT。平文は CLI のメモリ内のみで履歴に残さない |
| C3 | MCP 配布 | GitHub 直接インストール方式。**`mcp-blog/` は別 GitHub リポジトリ `sano/mcp-blog` として独立**。`npm install <github>` のサブディレクトリ指定が npm 公式仕様で安定していないため、独立リポジトリ化が最もシンプル。利用側は `npx -y github:sano/mcp-blog` で起動。npm 公開は将来必要になったら検討 |
| C4 | 下書き保存 | 既存の `published: false` を活用。S3 には保存され、`getPost` が `null` を返して公開ページには出ない。管理画面に「下書き一覧」タブを設けて編集再開を可能にする |
| C5 | md 最大サイズ | 5MB (API Gateway の payload 上限 10MB / Lambda 6MB に対する余裕分)。超過は `413 Payload Too Large` を返す。画像は別エンドポイントで pre-signed URL なので Lambda payload を消費しない |
| C6 | OIDC ロール権限拡張 | `.github/workflows/deploy.yml` の現行 OIDC ロールに `s3:GetObject`/`s3:ListBucket` (contentBucket、mediaBucket) を追加。CDK 側でロール ARN を ImportValue で参照しポリシーを attach |

## 確定した追加実装事項

上記決定に伴い、以下を Phase に追加する:

- **Phase 1 (CDK)** に追加:
  - CloudFront 既存 distribution に新 behavior `/api/*` を `RestApiOrigin` として追加 (`OriginRequestPolicy.ALL_VIEWER`、`CachePolicy.CACHING_DISABLED`、`AllowedMethods.ALLOW_ALL`)
  - 既存 GitHub Actions OIDC ロールへの追加権限を CDK で表現 (`Role.fromRoleArn` 経由で attach)
- **Phase 0 (新設) — 初期セットアップスクリプト**:
  - `scripts/set-admin-password.mjs` を作成: `argon2` ライブラリ + `aws-sdk/client-ssm` でハッシュ化 → PUT
  - `scripts/rotate-api-key.mjs` を作成: ランダム 32 byte hex キーを生成し Parameter Store に追加・古いキーを削除
  - 両スクリプトとも対話プロンプト (`readline`)、`--profile` `--region` フラグ対応
- **Phase 4 (MCP)** の構成見直し:
  - 新規リポジトリ `sano/mcp-blog` (別リポ) を作成し、コードはそちらで管理
  - 当初は blog repo 内の `mcp-blog/` ディレクトリで開発しつつ、git subtree push で `sano/mcp-blog` に同期する運用にしてもよい (もしくは最初から別リポ git clone)
  - ユーザー設定例:
    ```jsonc
    // ~/.claude/settings.json
    {
      "mcpServers": {
        "blog": {
          "command": "npx",
          "args": ["-y", "github:sano/mcp-blog"],
          "env": {
            "BLOG_API_ENDPOINT": "https://dxbqlfvrescw1.cloudfront.net/api",
            "BLOG_API_KEY": "..."
          }
        }
      }
    }
    ```

## Risks/Mitigations 更新

- **R-10** (MCP 初回配布) を更新: 「`mcp-blog` は最初から独立リポジトリ `sano/mcp-blog` で運用。`npx -y github:sano/mcp-blog` で起動可能」
- **R-12 (新規)**: CloudFront default ドメイン継続のため、API Gateway を直接公開せず必ず CloudFront 経由 (`/api/*`) で叩く運用にする。直接 API Gateway ドメインに送られるリクエストは API キー認証で阻止できるが、レイテンシと CORS が増えるため CloudFront 経由を強制する

---

すべての要件が確定しました。実装は `oh-my-claudecode:team` で並列実行 (Phase 1 / 3 型定義 / 4 を同時開始、Phase 2 は型定義完了後、Phase 5 は Phase 1 完了後) を推奨。
