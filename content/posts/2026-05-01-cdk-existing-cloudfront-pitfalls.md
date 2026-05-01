---
title: "AWS CDK で既存 CloudFront に Lambda+API Gateway を後付け拡張する 4 つの落とし穴"
icon: "cloud-cog"
type: "tech"
topics: ["AWS", "CDK", "CloudFront", "Lambda", "Debugging"]
published: true
category: "Debugging"
date: "2026-05-01"
description: "既存の CloudFront 配信 (S3 静的サイト) に CDK で API Gateway + Lambda を後付け拡張するときに踏んだ region pin、s3 sync --delete、ErrorResponses regression、/api/* prefix strip の 4 つの罠と回避方法を、実際の cdk diff / Lambda ログ / curl 出力と一緒にまとめる。"
coverImage: "/images/posts/2026-05-01-cdk-existing-cloudfront-pitfalls-cover.jpg"
---

## 概要

個人ブログ (静的 Next.js export を S3 + CloudFront で配信) に管理者投稿機能 (Lambda + API Gateway) を CDK で後付けする作業で、4 つの典型的な落とし穴を踏みました。「最初に試した間違ったアプローチ」と「修正後」を対比形式で残します。

| # | 落とし穴 | 症状 | 一言で |
|---|---------|------|--------|
| 1 | リージョン pin 漏れ | `cdk diff` で全リソースが `[+]` 表示、既存スタック上書きの恐怖 | profile 既定の `us-east-1` で空環境と diff されていた |
| 2 | `s3 sync --delete` の地雷 | GitHub Actions が git の `content/posts/` を全削除 | seed していない空 contentBucket と sync されていた |
| 3 | `errorResponses` の暗黙 regression | 既存 403→404 マッピングが消失、404.html が status 404 → 200 に化ける | CDK で 1 件しか書かなかったため上書きされた |
| 4 | `/api/*` behavior の未対応 prefix | CloudFront が API Gateway に転送しても 403 (Missing Authentication Token) | API Gateway は `/admin/...` resource しか持たないので `/api/admin/...` がマッチしない |

すべて、**CDK で「既存リソースを尊重しつつ、自分が触る部分だけ追加する」感覚が抜け落ちた**ことが原因でした。

## 1. CDK のリージョンが AWS profile に上書きされる

### ❌ 最初の `infra/bin/blog.ts`

```ts
new BlogStack(app, "BlogStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
  },
});
```

`??` でフォールバックを書いたので「`ap-northeast-1` で動くはず」と思い込んでいました。

ところが `aws configure list` の `region` が `us-east-1` だったため、CDK 起動時に AWS SDK が `CDK_DEFAULT_REGION = us-east-1` を auto-set します。`??` 演算子は **空文字や未定義の場合のみ** フォールバックするので、`us-east-1` が入っていれば発火しません。

### 症状

`cdk diff` の出力:

```
Resources
[+] AWS::S3::Bucket SiteBucket SiteBucket397A1860
[+] AWS::S3::Bucket MediaBucket MediaBucketBCBB02BA
[+] AWS::CloudFront::Distribution Distribution Distribution830FAC52
[+] AWS::CloudFront::Function UrlRewriteFunction ...
... (全リソース [+])
```

既存の `BlogStack` (CloudFront ドメイン `dxbqlfvrescw1.cloudfront.net` 含む)が、まるごと**新規作成扱い**で表示されました。「`cdk deploy` を押したら既存サイトが破壊される!?」と一瞬青ざめます。

実際は **`us-east-1` という空のリージョンに対して diff を取っていた** だけで、本物の `BlogStack` は `ap-northeast-1` に居て無事です。

### ✅ 修正

```ts
new BlogStack(app, "BlogStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",  // ハード固定
  },
});
```

これで AWS profile のデフォルトに関わらず、CDK は常に `ap-northeast-1` を見にいきます。

教訓:

- **マルチリージョンを意図しないならリージョンは文字列リテラルで固定** する
- `??` フォールバックは「未定義」のときしか発火しない。「想定外の値」が入っているケースを救えない
- 安全策として **diff 出力で `[~]` (modified) と `[+]` (created) の比率** を一瞥する。新規スタックでもないのに `[+]` だらけなら、そもそも違うスタック/環境を見ていないか疑う

## 2. `aws s3 sync --delete` が git のコンテンツを全削除

### ❌ 最初に書いた GitHub Actions ステップ

```yaml
- name: Sync content from S3
  run: |
    aws s3 sync "s3://${CONTENT_BUCKET}/posts/" content/posts/ --delete
    aws s3 sync "s3://${MEDIA_BUCKET}/" public/media/ --delete
```

「投稿は admin UI から S3 に書かれる → CI が S3 から `content/posts/` に sync」という設計です。`--delete` をつけたのは、削除した投稿がリポ側に残らないようにするため。

### 症状

`npm run build` で:

```
Error: Page "/tags/[tag]" is missing "generateStaticParams()" so it cannot be used with "output: export" config.
```

「あれ?」となります。Next.js のビルドが `/tags/[tag]` の `generateStaticParams` 関数を見つけられないと言っている。でもコードはちゃんと存在する。

ところがビルド時の `content/posts/` を確認すると **空っぽ**。`getAllPosts()` が空配列を返し、`getAllTags()` も空配列。`generateStaticParams` は空配列を返すので、「dynamic segment なのに静的パスが 1 個もない = `output: export` と矛盾」と Next.js がエラーを吐いていたわけです。

### 原因

`s3 sync s3://contentBucket/posts/ content/posts/ --delete` は:

1. S3 から `content/posts/` に同期
2. `--delete` で「**S3 にないが local にあるもの**」を全削除

contentBucket をまだ seed していなかったので、S3 は空。すると **git checkout した `content/posts/` の 9 記事が全部削除** されました。

### ✅ 修正

CI を回す前に、git の `content/posts/` を初期 seed として contentBucket に push:

```bash
aws s3 sync content/posts/ s3://blogstack-contentbucket52d4b12c-vlieblesuakw/posts/
```

これで S3 が source of truth として 9 記事を持つ状態になり、`s3 sync --delete` が「local の 9 記事 = S3 の 9 記事」とみなしてくれて削除されません。

教訓:

- `s3 sync --delete` は **両側を一致させる**操作。空 S3 → 空 local。これは `git pull --force` 級の破壊力
- 設計上「S3 が source of truth」と決めたら、最初に必ず seed する
- できれば `--delete` の前に dry-run (`--dryrun`) で何が消えるか確認する習慣をつける

## 3. CloudFront `errorResponses` の暗黙 regression

### ❌ 最初の CDK コード

```ts
new cloudfront.Distribution(this, "Distribution", {
  // ...
  errorResponses: [
    {
      httpStatus: 404,
      responsePagePath: "/404.html",
      responseHttpStatus: 200,
      ttl: cdk.Duration.seconds(0),
    },
  ],
});
```

Next.js のクライアントサイド 404 ハンドリング流儀に倣って 1 件だけ書きました。

### 症状

`cdk diff` で:

```
[~] CustomErrorResponses:
  [-] ErrorCode: 403, ResponseCode: 404, ResponsePagePath: /404.html
  [~] ErrorCode: 404, ResponseCode: 404 → 200
```

既存配信は **403→404 と 404→404 の 2 件** をマッピングしていました。S3 OAC (Origin Access Control) は missing object に対して 403 を返すため、403 を 404 に変換するマッピングは必須でした。新コードでは:

- 403→404 マッピングが**消失**
- 404 の status code が 404 → 200 に**改変**

両方とも regression。本番反映していたら、`/posts/foo` のような存在しないパスが「404 ステータスを返さない」「Next.js の 404 ページではなく S3 の生 403 を返す」状態になりました。

### ✅ 修正

```ts
errorResponses: [
  {
    httpStatus: 403,
    responsePagePath: "/404.html",
    responseHttpStatus: 404,
    ttl: cdk.Duration.seconds(0),
  },
  {
    httpStatus: 404,
    responsePagePath: "/404.html",
    responseHttpStatus: 404,
    ttl: cdk.Duration.seconds(0),
  },
],
```

既存仕様 (403→404, 404→404) を完全再現。

教訓:

- 既存リソースに後付け拡張する CDK では、**現状を `aws ...get-distribution-config` で取得して全フィールドの仕様書を作ってから書く**
- `cdk diff` の `[~]` (modified) は無視せず、想定外の差分が出ていないか必ず精読する
- 特に `errorResponses` のような「設定漏れ = サイレント regression」になる項目は要注意

## 4. CloudFront `/api/*` が API Gateway に届かない

### ❌ 最初の CDK コード

```ts
additionalBehaviors: {
  "/api/*": {
    origin: new origins.RestApiOrigin(restApi),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  },
},
```

`https://example.com/api/admin/login` を `https://abc123.execute-api.../prod/admin/login` に転送する想定で、これで動くと思っていました。

### 症状

curl すると:

```
$ curl -i -X POST "https://example.com/api/admin/login" -H "Content-Type: application/json" -d '{"password":"wrong"}'
HTTP/2 404
content-type: text/html
last-modified: Mon, 27 Apr 2026 09:48:59 GMT
server: AmazonS3
x-cache: Error from cloudfront

<!DOCTYPE html>... (Next.js の 404 ページ)
```

「404 から S3 の 404.html が返っている = 404 のせいで `/api/*` behavior が機能していない」と勘違いし、CloudFront 設定を散々確認しました。実際は `/api/*` behavior は正しく一致していて、API Gateway に転送されていました。

問題は **転送される URI の `/api` prefix**。CloudFront は `request.uri = /api/admin/login` をそのまま origin (API Gateway) に渡します。`OriginPath` を `/prod` (stage 名) にしておけば API Gateway は `/prod/api/admin/login` を受信。**API Gateway は `/api/admin/...` リソースを持っていない** (`/admin/...` のみ) ので、Missing Authentication Token (= 403) を返します。CloudFront の `errorResponses` (4. の修正後) で 403→404 にマップされ、`/404.html` が S3 から返ります。だから `server: AmazonS3` の 404 になっていました。

### ✅ 修正

CloudFront Function (viewer-request) を `/api/*` behavior にだけ associate して、prefix を strip:

```ts
const apiPrefixStripFunction = new cloudfront.Function(this, "ApiPrefixStripFunction", {
  code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/api' || uri === '/api/') {
    request.uri = '/';
  } else if (uri.indexOf('/api/') === 0) {
    request.uri = uri.substring(4); // remove leading "/api"
  }
  return request;
}
`),
  runtime: cloudfront.FunctionRuntime.JS_2_0,
});

// /api/* behavior に追加
"/api/*": {
  // ...既存設定
  functionAssociations: [
    { function: apiPrefixStripFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
  ],
},
```

これで CloudFront が `/api/admin/login` を `/admin/login` に書き換えてから API Gateway に転送します。API Gateway 側でも resource が一致して、Lambda にプロキシされ、正しく 401 (or 200) が返るようになります。

検証:

```
$ curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://example.com/api/admin/login" \
  -H "Content-Type: application/json" -d '{"password":"wrong"}'
401
```

教訓:

- `Authorization` ヘッダなしで API Gateway を叩くと 403 (Missing Authentication Token) **= リソースが存在しないときと同じ status**。混同しやすい
- `server: AmazonS3` のエラーレスポンスを見たら CloudFront の error mapping を疑う。「behavior が動いていない」ではなく「動いているけど upstream がエラー → CloudFront が S3 にフォールバック」のことが多い
- prefix を維持して転送するか strip するかは、CloudFront origin の `OriginPath` と CloudFront Function の二段で考える

## バイブコーディングで実装する

AI コーディングアシスタントに上記 4 点を一度に伝えるためのプロンプト例:

```
既存の AWS CloudFront 配信 (S3 静的サイト) に CDK で API Gateway + Lambda を
後付け追加する。以下 4 点を守って実装してほしい:

1. infra/bin/blog.ts は env.region を文字列リテラル (例: "ap-northeast-1") で
   ハード固定する。CDK_DEFAULT_REGION フォールバックは使わない (AWS profile
   default で上書きされてリージョンを間違える事故を防ぐ)。

2. GitHub Actions の workflow で aws s3 sync --delete を使う場合、最初に
   git の content を S3 にも push する初期 seed ステップを README に書く。
   さもないと CI 初回実行で git の content が S3 (空) と sync --delete されて
   全削除される。

3. CloudFront Distribution の errorResponses は 403 と 404 の両方を
   /404.html に同じ status code (例: 404) でマッピングする。S3 OAC が
   missing object で 403 を返すため、403→404 マッピングが必須。

4. CloudFront に /api/* behavior を追加するとき、CloudFront Function
   (viewer-request) で /api prefix を strip してから API Gateway へ転送する。
   API Gateway 側のリソースは /admin/... など prefix なしで定義し、prefix を
   API Gateway 側で持たせない。これで /api/admin/login が API Gateway 側で
   /admin/login として正しくルーティングされる。
```

## まとめ

- CDK でリージョンを `process.env.CDK_DEFAULT_REGION ?? "..."` と書くと、AWS profile 経由で意図しないリージョンに当たる。**ハード固定**
- `aws s3 sync --delete` は両側を一致させる操作。**S3 を空のまま走らせると git の content が消える**。事前 seed が必須
- CloudFront `errorResponses` を CDK で書くときは、**既存配信の現状を全フィールド精読** してから書かないと regression が出る
- CloudFront `/api/*` を API Gateway に転送するときは、**`/api` prefix を CloudFront Function で strip** しないと API Gateway 側で 403 (Missing Authentication Token) になる

どれも CDK で「既存リソースを尊重しつつ、自分が触る部分だけ追加する」ときに踏みやすい罠でした。`cdk diff` の `[~]` 出力を疑いながら読む習慣を身につけたいところです。
