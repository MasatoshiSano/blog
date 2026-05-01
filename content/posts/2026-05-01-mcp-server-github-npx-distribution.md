---
title: "自作 MCP サーバを `npx -y github:owner/repo` で配布する — prepare スクリプトと dist commit のコツ"
icon: "package"
type: "tech"
topics: ["MCP", "npm", "npx", "GitHub", "TypeScript"]
published: true
category: "HowTo"
date: "2026-05-01"
description: "Model Context Protocol の自作サーバを npm 公開せずに GitHub から直接 npx でインストールできるようにする。prepare スクリプトでビルドしようとして詰まる典型パターンを避け、pre-built dist を distribution repo にコミットする運用に落ち着いた話。"
coverImage: "/images/posts/2026-05-01-mcp-server-github-npx-distribution-cover.webp"
---

## 概要

Claude Code から「任意のプロジェクトで自分のブログに投稿できる」用途で、自作 MCP (Model Context Protocol) サーバを書きました。インストールは `~/.claude.json` に以下を書くだけにしたい:

```jsonc
{
  "mcpServers": {
    "blog": {
      "command": "npx",
      "args": ["-y", "github:owner/repo"],
      "env": { "BLOG_API_ENDPOINT": "...", "BLOG_API_KEY": "..." }
    }
  }
}
```

つまり **npm 公開せず GitHub から直接 npx でインストール** したい。これは npm 公式仕様の `git source dependency` に乗っかれるはずでした。

ところが、最初のセットアップでは `claude mcp list` で `✗ Failed to connect` になり、原因究明に時間を使いました。

最終的にたどり着いた運用は:

- **`prepare` スクリプトを使わない** (git install では devDeps が完全に入らずビルド失敗するため)
- **pre-built `dist/` を distribution repo にコミット** する (`.gitignore` を分ける)

理由を順を追って説明します。

## ❌ 最初のセットアップ

`mcp-blog/package.json`:

```jsonc
{
  "name": "mcp-blog",
  "type": "module",
  "bin": { "mcp-blog": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "prepare": "npm run build"   // ← これが落とし穴
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
    // ← @types/node が抜けていた (これも落とし穴)
  },
  "files": ["dist"]
}
```

`.gitignore` で `dist/` を除外していました (ビルド成果物を git に入れたくない)。

「git source dependency でも `prepare` 経由で自動ビルドされるはず」と思っていました。実際 npm 公式ドキュメントにもそう書いてあります。

## 症状

`npx -y github:owner/repo` を試すと:

```
$ git clone --depth 1 https://github.com/owner/repo.git /tmp/test
$ cd /tmp/test
$ npm install
npm error code 2
npm error path /tmp/test
npm error command failed
npm error command sh -c npm run build

src/client.ts(50,20): error TS2580: Cannot find name 'process'.
   Do you need to install type definitions for node? Try `npm i --save-dev @types/node`.
```

`prepare` 内の `tsc` が **`process` が見つからない** で失敗。

```
$ ls node_modules/@types/node
ls: cannot access 'node_modules/@types/node': No such file or directory
```

`@types/node` が `node_modules/` に入っていません。`devDependencies` に書いていなかったので install 漏れていた **+** root の repo から hoist されていたから local の build は通っていた、という二重の罠でした。

## 中間試行: `@types/node` を devDependencies に追加

```jsonc
"devDependencies": {
  "@types/node": "^22.10.0",
  "typescript": "^5.8.0"
}
```

これで local の `npm run build` は確実に通るようになりました。が、**`npx -y github:owner/repo` ではまだ Failed**。

理由: **npm 7+ は git source dependency をインストールするとき、devDependencies を一部スキップする**。具体的には:

- 自分のリポジトリ (top-level) で `npm install <git-source>` ... 普通に全部入る
- パッケージとして配布 (`npm publish` の登録対象) ... 普通に全部入る
- **`npx <git-source>` 経由で fetch + 一時 install** ... `--omit=dev` 相当で devDeps が省かれる

これが何度確認しても再現しました。

ということは `prepare → tsc` のチェーンを `devDeps` 側に置いている限り、`npx -y github:` 配布では絶対に build できない。

## ✅ 解決策: prepare を捨て、dist を commit

「distribution 時にビルドが必要」とすると上記の罠を踏み続けるので、発想を切り替えました。

> **配布物 (distribution repo) には pre-built dist を含める。git fetch → install で ready-to-run。**

具体的に:

- `mcp-blog/package.json` から `prepare` スクリプトを削除
- distribution repo (今回は `MasatoshiSano/mcp-blog`) では `.gitignore` から `dist/` を **除外しない** (= dist を commit)
- 開発リポ (今回は `MasatoshiSano/blog/mcp-blog`) では `.gitignore` で `dist/` を除外したまま (dev 用に build はするけどコミットしない)

それぞれの repo:

| repo | dist tracked? | npm install on git fetch | 用途 |
|------|---------------|--------------------------|------|
| `MasatoshiSano/blog/mcp-blog` (dev) | No (gitignored) | (該当なし) | ローカル開発・編集 |
| `MasatoshiSano/mcp-blog` (dist) | **Yes (committed)** | runtime deps だけ install | `npx -y github:` 配布用 |

dist repo の package.json:

```jsonc
{
  "name": "mcp-blog",
  "type": "module",
  "bin": { "mcp-blog": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
    // prepare は無し
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.8.0"
  },
  "files": ["dist"]
}
```

`prepare` がないので `npm install` は依存だけ入れて終わり。`bin/mcp-blog` は事前にビルド済みの `dist/index.js` を直接実行できます。

### dev → dist への同期スクリプト

dev repo から dist repo への push は `git subtree split` + force-include dist を使います:

```bash
# 開発側でビルド
cd ~/projects/blog/mcp-blog
npm run build

# distribution repo を clone (初回のみ)
cd /tmp
git clone https://github.com/owner/mcp-blog.git
cd mcp-blog

# 同期: 開発側からファイルをコピー
rsync -a --delete --exclude=.git --exclude=node_modules \
  ~/projects/blog/mcp-blog/ ./

# .gitignore から dist/ を外す (dev repo の .gitignore は dist を除外している)
sed -i '/^dist\/$/d' .gitignore

# 確認
git status

# commit + push
git add -A
git commit -m "build: ship pre-compiled dist"
git push origin main
```

これで `npx -y github:owner/mcp-blog` が ready-to-run の状態で配布できます。

## `claude mcp add` の引数順序

ついでに ハマりポイントを 1 つ。`claude mcp add` で env を指定するときは、**name の前か後かで挙動が変わる**:

❌ env を name の前に書くと variadic に巻き込まれる:
```
claude mcp add --scope user -e KEY=val blog -- npx -y github:owner/repo
# → error: missing required argument 'name'
```

✅ name を先に書く:
```
claude mcp add --scope user blog -e KEY=val -e KEY2=val2 -- npx -y github:owner/repo
# → Added stdio MCP server blog
```

`-e` が variadic オプションなので、間に位置引数を挟まないと name が `-e` に吸収されます。

## 動作確認

```bash
$ claude mcp list
blog: npx -y github:MasatoshiSano/mcp-blog - ✓ Connected
```

`✓ Connected` が出れば OK。MCP ツールが Claude Code から呼べるようになります。

## バイブコーディングで実装する

AI コーディングアシスタントへの指示例:

```
TypeScript で書いた MCP server を npx -y github:owner/repo で配布できるように
セットアップしてほしい。

要件:
1. package.json から prepare スクリプトを削除する。git source の npm install は
   devDeps を完全に install しないため、prepare 内の tsc が必ず失敗する
2. devDependencies に @types/node を必ず明示する (root から hoist されていても
   distribution repo では効かない)
3. distribution repo (例: github:owner/mcp-blog) では .gitignore から dist/ を
   外し、ビルド済み dist/ を commit する
4. 開発 repo (monorepo の subdir) は .gitignore で dist/ を除外したまま
5. dev → dist の同期は手動 rsync + git push で OK (CI 化したければ別途)
6. ~/.claude.json の mcpServers.<name>.args に "npx", "-y", "github:owner/repo" を
   並べる。env も同じオブジェクトに

claude mcp add CLI を使う場合の引数順序は:
  claude mcp add --scope user <name> -e KEY=val -- npx -y github:owner/repo
(name を -e の前に置かないと name が variadic に吸収される)
```

## まとめ

- `npx -y github:owner/repo` で MCP サーバを配布するには、`prepare` 経由のビルド戦略を捨てる
- distribution repo には **pre-built dist を commit** する。`.gitignore` を dev/dist で分ける
- `@types/node` のような **コンパイルだけに使う型定義は明示的に devDeps に書く** (hoist 任せにしない)
- `claude mcp add` は name を `-e` の前に置く

「ビルドしてもらう前提」より「ビルド済みを配布する前提」の方が、git fetch ベースの配布では壊れにくいことが分かりました。
