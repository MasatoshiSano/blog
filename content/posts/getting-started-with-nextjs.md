---
title: "Next.js 15でブログを構築する — App Router + SSGで始めるモダンブログ"
emoji: "🚀"
type: "tech"
topics: ["Next.js", "React", "TypeScript", "Blog"]
published: true
category: "Frontend"
date: "2025-01-15"
featured: true
series: "Next.js入門"
seriesOrder: 1
coverImage: "/images/posts/laptop-code.jpg"
description: "Next.js 15のApp Routerを使って、静的サイト生成(SSG)でモダンなブログを構築する方法を紹介します。"
---

## はじめに

Next.js 15のApp Routerを使って、静的サイト生成(SSG)でブログを構築する方法を紹介します。

## こんな人向け

- Next.js 15のApp Routerでブログを一から構築したい
- SSG（静的サイト生成）を使ったブログの作り方を知りたい
- React + TypeScriptでモダンなブログを作る具体的な手順を探している

## プロジェクトのセットアップ

まずは新しいNext.jsプロジェクトを作成しましょう。

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
```

`output: "export"` を設定することで、静的HTMLファイルとして出力されます。

## App Routerの活用

Next.js 15のApp Routerでは、ファイルベースのルーティングが強化されています。

```
src/app/
├── layout.tsx       # ルートレイアウト
├── page.tsx         # トップページ
└── posts/
    └── [slug]/
        └── page.tsx # 記事詳細
```

### generateStaticParams

動的ルートの静的生成には `generateStaticParams` を使います。

```typescript
export async function generateStaticParams() {
  const slugs = getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}
```

## まとめ

Next.js 15 + SSGの組み合わせは、ブログのような静的コンテンツに最適です。サーバーサイドの処理が不要なため、S3 + CloudFrontでホスティングできます。
