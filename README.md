# Tech Blog

フロントエンド、バックエンド、インフラのテクノロジーブログ

## 概要

Next.js で構築された静的サイト生成ブログです。Markdown ファイルで記事を管理し、AWS（S3 + CloudFront）にホスティングされます。

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| フレームワーク | Next.js 15 (App Router, Static Export) |
| UI | React 19, Tailwind CSS 4 |
| 型安全性 | TypeScript 5 |
| Markdown | unified, remark, rehype, shiki |
| 検索 | Fuse.js（クライアントサイドあいまい検索） |
| RSS | feed |
| インフラ | AWS CDK (S3 + CloudFront) |

## 開発環境のセットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。

## 記事の投稿

### 1. Markdown ファイルを作成

`content/posts/` ディレクトリに `.md` ファイルを作成します。

```
content/posts/your-article-slug.md
```

### 2. フロントマターを設定

```yaml
---
title: "記事タイトル"
emoji: "🚀"
type: "tech"          # "tech" または "idea"
topics: ["Next.js", "React"]
published: true       # false にすると下書き
category: "フロントエンド"
date: "2024-01-01"
updated: "2024-01-10" # 任意
featured: false        # サイドバーの注目記事に表示
series: "シリーズ名"  # 任意
seriesOrder: 1         # 任意
---
```

### 3. 本文を Markdown で記述

GitHub Flavored Markdown（テーブル、コードブロック等）に対応しています。

シンタックスハイライト付きコードブロック:

````markdown
```typescript
const greeting = "Hello, World!";
console.log(greeting);
```
````

### 4. ローカルで確認

```bash
npm run dev
```

### 5. デプロイ

`main` ブランチへプッシュすると GitHub Actions が自動でビルド・デプロイします。

```bash
git add content/posts/your-article-slug.md
git commit -m "記事: タイトル"
git push origin main
```

## ディレクトリ構成

```
blog/
├── content/
│   └── posts/          # Markdown 記事ファイル
├── infra/              # AWS CDK インフラコード
│   ├── bin/
│   └── lib/
├── src/
│   ├── app/            # Next.js App Router ページ
│   ├── components/     # React コンポーネント
│   │   ├── articles/
│   │   ├── layout/
│   │   ├── sidebar/
│   │   └── ui/
│   ├── lib/            # データアクセス・Markdown 処理
│   └── types/          # TypeScript 型定義
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

## 利用可能なスクリプト

```bash
npm run dev        # 開発サーバー起動
npm run build      # 本番ビルド（静的出力）
npm run start      # 本番サーバー起動
npm run lint       # ESLint 実行
npm run typecheck  # TypeScript 型チェック
```

## インフラ (AWS CDK)

`infra/` ディレクトリに AWS CDK のコードがあります。

```bash
cd infra
npm install
npx cdk deploy
```

**構成:**
- **S3 (SiteBucket)**: 静的サイトファイルのホスティング
- **S3 (MediaBucket)**: 画像・メディアファイルのホスティング (`/media/*`)
- **CloudFront**: CDN + HTTPS 配信（OAC によるプライベートアクセス）

## 主な機能

- **記事一覧・詳細ページ**: カテゴリ・タグによるフィルタリング
- **シリーズ記事**: 連載記事のナビゲーション
- **関連記事**: 記事詳細ページでの関連記事表示
- **目次**: h2/h3 見出しから自動生成
- **検索**: `Cmd+K` / `Ctrl+K` でキーワード検索
- **RSS フィード**: `/feed.xml`
- **ページネーション**: 1ページあたり12件
- **SNS シェアボタン**: 各記事に設置
