---
title: "Next.js 15 + output:'export' で useSearchParams を使うと build が落ちる — Suspense ラップで解決"
icon: "alert-triangle"
type: "tech"
topics: ["Next.js", "React", "Static Export", "TypeScript"]
published: true
category: "Debugging"
date: "2026-05-01"
description: "Next.js 15 の output:'export' で useSearchParams を使うコンポーネントが prerender で fail する原因と、Suspense boundary でラップする標準パターンを示す。"
coverImage: "/images/posts/2026-05-01-nextjs-static-export-usesearchparams-suspense-cover.jpg"
---

## 概要

静的エクスポート (`output: "export"`) で Next.js 15 を使っているプロジェクトに、URL クエリパラメータ (`?slug=foo`) で初期値を変える編集ページを追加したら、ビルドで以下のエラーが出ました。

```
Error occurred prerendering page "/admin/edit". Read more: https://nextjs.org/docs/messages/prerender-error
Export encountered an error on /admin/edit/page: /admin/edit, exiting the build.
```

原因は `useSearchParams()` で、修正は **Suspense boundary でラップ** するだけでした。Next.js 15 + 静的エクスポートの組み合わせで踏みやすい罠なのでメモを残します。

## なぜ落ちるか

`useSearchParams()` (`next/navigation`) は **viewport / クライアント側でしか確定しない値** を返します。Next.js が静的エクスポートでページを prerender するとき、HTML に焼き込めない値を読もうとするため fail します。

「`"use client"` を付けてればクライアントコンポーネントだから動くだろう」と思っていたのですが、**Next.js は静的エクスポートでもクライアントコンポーネントを一度 SSR して** HTML を吐きます (Hydration 用の初期 HTML)。その SSR 段階で `useSearchParams` が呼ばれると、prerender エラーになります。

## ❌ 最初のコード

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function EditPage() {
  const searchParams = useSearchParams();
  const slug = searchParams?.get("slug") ?? "";

  const [data, setData] = useState(null);

  useEffect(() => {
    if (!slug) return;
    fetchPost(slug).then(setData);
  }, [slug]);

  // ... フォーム描画
}
```

`"use client"` も付いているし、`useEffect` で API 呼び出しもしているのに、`output: "export"` のビルドが通らない。

## ✅ 修正後

トップレベルを Suspense boundary に変えて、`useSearchParams` を使う実装を内側のコンポーネントに切り出します。

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function EditPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      }
    >
      <EditPageInner />
    </Suspense>
  );
}

function EditPageInner() {
  const searchParams = useSearchParams();
  const slug = searchParams?.get("slug") ?? "";

  const [data, setData] = useState(null);

  useEffect(() => {
    if (!slug) return;
    fetchPost(slug).then(setData);
  }, [slug]);

  // ... フォーム描画
}
```

ポイント:

- `EditPage` はただの Suspense boundary 。`useSearchParams` は呼ばない
- `EditPageInner` の中でだけ `useSearchParams` を呼ぶ。Suspense が SSR 時の fallback を出してくれて、prerender 段階で実値の解決を保留
- ファイル全体で `"use client"` は維持

これだけでビルドが通り、`/admin/edit/index.html` が `out/` に生成されるようになります。

## 動作の流れ

1. ビルド時: `EditPage` が SSR されると、Suspense fallback (Loader アイコンだけ) の HTML が `/admin/edit/index.html` に焼かれる
2. ブラウザ初回表示: その fallback HTML がまず表示される
3. Hydration 後: `EditPageInner` がクライアント側で実行され、`useSearchParams()` が解決し、`useEffect` で API 呼び出しが走り、フォームが描画される

ユーザーから見ると一瞬スピナーが出てフォームが表示される、という普通の挙動です。

## なぜ `useEffect` で逃げないのか

「`useEffect` の中で `window.location.search` をパースすればクライアント側だけで解決するから問題ないのでは?」と思うかもしれません。実際それも動きます。

```tsx
"use client";

export default function EditPage() {
  const [slug, setSlug] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSlug(params.get("slug") ?? "");
  }, []);
  // ...
}
```

ただ、これは:

- Next.js のサーバ/クライアント抽象 (`useSearchParams`) を捨てて生 `window.location` を触る
- `useState("")` の初期値と最初の render が描画される一瞬がチラつく (FOUC 的)

Next.js の作法に乗っかるなら **Suspense + `useSearchParams`** が正解です。

## バイブコーディングで実装する

AI コーディングアシスタントへの指示例:

```
Next.js 15 + output:"export" のプロジェクトで、URL のクエリパラメータ
?slug=... で初期値が変わる /admin/edit ページを作って。

要件:
- ファイル: src/app/admin/edit/page.tsx
- "use client" 必須
- top-level の default export を <Suspense fallback={<Loader />}> でラップし、
  useSearchParams を呼ぶのは内側のコンポーネントだけにする
  (これをやらないと output:"export" の build が "Error occurred prerendering page"
  で fail する)
- 内側コンポーネントで useSearchParams() で slug を取り、useEffect で API を叩いて
  既存値をロード
- ロード中・エラー・本体表示の 3 状態を持つ
```

## まとめ

`useSearchParams` を使うコンポーネントは、**Next.js 15 + `output: "export"` では Suspense でラップする** のが必須。`"use client"` だけでは足りません。これは Next.js 公式の推奨パターンでもあります。

エラーメッセージは "Error occurred prerendering page" としか出ないので、最初は何が起きているのか分かりにくいですが、原因はほぼ `useSearchParams` (もしくは類似のクライアント専用 hook) と覚えておけば即座に対処できます。
