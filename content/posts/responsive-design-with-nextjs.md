---
title: "Next.jsでレスポンシブデザインを実践する — Tailwind CSS v4でモバイルファースト構築"
emoji: "📱"
type: "tech"
topics: ["Next.js", "Tailwind", "CSS", "React"]
published: true
category: "Frontend"
date: "2026-02-19"
featured: true
coverImage: "/images/posts/coding-screen.jpg"
description: "Next.js 15とTailwind CSS v4を使って、モバイルファーストのレスポンシブなWebアプリケーションを構築する実践的な手法を解説します。"
---

## はじめに

モダンなWebアプリケーションでは、デスクトップからモバイルまで、さまざまなデバイスに対応したレスポンシブデザインが必須です。この記事では、Next.js 15とTailwind CSS v4を組み合わせて、効率的にレスポンシブなUIを構築する方法を紹介します。

![レスポンシブデザインのイメージ](/images/posts/workspace.jpg)
*モダンな開発環境でのレスポンシブデザイン開発*

## こんな人向け

- Next.js + Tailwind CSSでモバイル対応のUIを効率的に作りたい
- レスポンシブデザインのブレークポイント設計に迷っている
- Tailwind CSS v4のレスポンシブユーティリティの使い方を知りたい

## Tailwind CSSのブレークポイント

Tailwind CSSはモバイルファーストのアプローチを採用しています。

```typescript
const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px"
};
```

## レスポンシブなグリッドレイアウト

```tsx
export function ArticleGrid({ posts }: { posts: Post[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <ArticleCard key={post.slug} post={post} />
      ))}
    </div>
  );
}
```

![コードエディタでの開発](/images/posts/code-editor.jpg)
*VSCodeでのTailwind CSSを使った開発の様子*

## レスポンシブなタイポグラフィ

```tsx
export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-2xl font-bold leading-tight md:text-3xl lg:text-4xl">
      {children}
    </h1>
  );
}
```

## 画像の最適化

```tsx
import Image from "next/image";

export function ResponsiveImage({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      className="object-cover"
    />
  );
}
```

![開発風景](/images/posts/laptop-code.jpg)
*ラップトップでの開発風景*

## まとめ

- **モバイルファースト**のアプローチでスタイルを書く
- **ブレークポイント**を活用してデバイスごとにレイアウトを調整
- **画像の最適化**でパフォーマンスを確保
- **CSSベース**の表示切り替えでJSバンドルを削減
