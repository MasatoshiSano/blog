---
title: "Next.js ブログを git push だけで自動デプロイする — CDK + GitHub Actions + S3 + CloudFront 構成ガイド"
emoji: "🚀"
type: "tech"
topics: ["Next.js", "AWS", "CDK", "CloudFront", "GitHub", "DevOps"]
published: true
category: "HowTo"
date: "2026-03-01"
description: "Next.js の静的エクスポートを GitHub Actions で S3 にデプロイし、CloudFront で配信する構成を CDK で一括構築する方法を解説"
coverImage: "/images/posts/nextjs-blog-auto-deploy-s3-cloudfront-cover.jpg"
---

## 概要

ブログを書いたら `git push` するだけで本番に反映される——この記事では、その仕組みを **Next.js + AWS CDK + GitHub Actions** で構築する方法を解説する。

構成の全体像はシンプルだ。

```
git push main
  → GitHub Actions 起動
    → Next.js ビルド（静的 HTML 生成）
    → S3 にアップロード
    → CloudFront キャッシュ無効化
  → 数分後にサイト反映
```

インフラは CDK でコード管理するので、環境の再現やカスタマイズも容易になる。

## こんな人向け

- Next.js で個人ブログやドキュメントサイトを作り、AWS でホスティングしたい
- Vercel 等のマネージドサービスを使わず、自前で CI/CD パイプラインを組みたい
- CDK でインフラを管理しつつ、デプロイを完全自動化したい
- CloudFront で `/posts/slug` のようなクリーン URL を実現する方法を知りたい

## 前提条件

- Node.js 20 以上
- AWS アカウント（CDK ブートストラップ済み）
- GitHub リポジトリ
- AWS CDK v2 (`aws-cdk-lib ^2.170.0`)

## アーキテクチャ

```
┌──────────┐     push      ┌──────────────────┐
│  GitHub  │──────────────→│  GitHub Actions   │
│  (main)  │               │  - npm run build  │
└──────────┘               │  - aws s3 sync    │
                           │  - cf invalidate  │
                           └────────┬─────────┘
                                    │ OIDC
                                    ▼
┌──────────────────────────────────────────────┐
│                   AWS                         │
│                                               │
│  ┌────────┐  OAC   ┌────────────────────┐    │
│  │   S3   │◄───────│    CloudFront      │    │
│  │ (静的  │        │  - HTTPS リダイレクト│    │
│  │  HTML) │        │  - URL リライト     │    │
│  └────────┘        │  - カスタム 404     │    │
│                    └────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 手順 1: Next.js を静的エクスポートに設定する

S3 でホスティングするには、Next.js のビルド出力を静的 HTML にする必要がある。`next.config.ts` で `output: "export"` を指定する。

```ts
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

**なぜ `images.unoptimized: true` が必要か**: Next.js の Image Optimization は Node.js サーバーが必要だが、静的エクスポートではサーバーが存在しない。このオプションで最適化をスキップし、元画像をそのまま配信する。

## 手順 2: CDK でインフラを定義する

CDK スタックで S3 バケットと CloudFront ディストリビューションを構築する。設計判断のポイントは3つある。

### 設計判断 1: S3 は完全非公開 + OAC でアクセス

S3 バケットのパブリックアクセスを全ブロックし、CloudFront の OAC（Origin Access Control）経由でのみアクセスを許可する。直接 S3 の URL を叩いてもアクセスできないため、セキュリティが確保される。

### 設計判断 2: CloudFront Function で URL リライト

Next.js の静的エクスポートは `/posts/slug.html` のようなファイルを生成するが、ユーザーには `/posts/slug` というクリーン URL でアクセスしてほしい。CloudFront Function（Lambda@Edge より軽量・高速）で、拡張子なしのリクエストに `.html` を付与する。

### 設計判断 3: Price Class 100 でコスト最小化

個人ブログであればアクセス元は限られる。`PRICE_CLASS_100` を選ぶことで、北米・欧州のエッジロケーションのみ使用し、コストを抑える。

```ts
// infra/lib/blog-stack.ts
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import type { Construct } from "constructs";

export class BlogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3: パブリックアクセス全ブロック
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // CloudFront Function: クリーン URL → .html にリライト
    const urlRewriteFunction = new cloudfront.Function(
      this,
      "UrlRewriteFunction",
      {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  }
  else if (uri.startsWith('/_next/') || uri.startsWith('/images/')) {
    // 静的アセット: リライト不要
  }
  else if (uri.match(/\\.(xml|ico|txt|svg|png|jpg|webp|json)$/)) {
    // 既知のファイル拡張子: リライト不要
  }
  else if (!uri.endsWith('.html')) {
    request.uri += '.html';
  }

  return request;
}
`),
        runtime: cloudfront.FunctionRuntime.JS_2_0,
      }
    );

    // CloudFront: OAC で S3 にアクセス
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: urlRewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responsePagePath: "/404.html",
          responseHttpStatus: 200,
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // デプロイに必要な値を出力
    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
    });
    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
  }
}
```

CDK デプロイ後、出力される `SiteBucketName` と `DistributionId` を GitHub Secrets に設定する。

## 手順 3: GitHub Actions で CI/CD パイプラインを構築する

`main` ブランチへの push をトリガーに、ビルドからデプロイまで自動実行する。

```yaml
# .github/workflows/deploy.yml
name: Deploy Blog

on:
  push:
    branches:
      - main

permissions:
  id-token: write   # OIDC トークン発行に必要
  contents: read

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ap-northeast-1

      - name: Deploy to S3
        env:
          S3_BUCKET: ${{ secrets.S3_BUCKET_NAME }}
        run: aws s3 sync out/ "s3://${S3_BUCKET}" --delete

      - name: Invalidate CloudFront cache
        env:
          CF_DISTRIBUTION_ID: ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }}
        run: |
          aws cloudfront create-invalidation \
            --distribution-id "${CF_DISTRIBUTION_ID}" \
            --paths "/*"
```

### なぜ OIDC 認証を使うのか

`aws-actions/configure-aws-credentials` の `role-to-assume` は OIDC（OpenID Connect）による一時認証を使う。長期的なアクセスキーを GitHub Secrets に保存する方式と比べて:

- **アクセスキーが漏洩するリスクがない**（一時トークンは数分で失効）
- **IAM ロールで権限を最小限に絞れる**（S3 と CloudFront の操作のみ許可）
- **`id-token: write` 権限**がワークフローに必要な点だけ注意

### 必要な GitHub Secrets

| Secret 名 | 値 |
|-----------|------|
| `AWS_ROLE_ARN` | OIDC 用 IAM ロールの ARN |
| `S3_BUCKET_NAME` | CDK 出力の `SiteBucketName` |
| `CLOUDFRONT_DISTRIBUTION_ID` | CDK 出力の `DistributionId` |

## ポイント・注意点

### `s3 sync --delete` の挙動

`--delete` フラグにより、ビルド出力に存在しないファイルは S3 から削除される。つまり記事の Markdown を消してプッシュすれば、次のデプロイで本番からも消える。意図しない削除を防ぐために、**main ブランチへの直接プッシュを制限し、PR レビューを挟む運用**も検討すべき。

### CloudFront キャッシュの無効化コスト

`--paths "/*"` は全パスを無効化する。月 1,000 パスまで無料だが、頻繁にデプロイすると料金が発生しうる。個人ブログの更新頻度であれば問題ないが、1日に何十回もデプロイする場合は注意。

### CloudFront Function の制約

CloudFront Function は最大実行時間が 1ms、メモリ 2MB という制約がある。URL リライト程度の処理なら十分だが、複雑なロジック（認証チェック等）が必要なら Lambda@Edge を検討する。

### 404 ページの `responseHttpStatus: 200`

SPA のフォールバックではなく、静的サイトの場合 `404` を返すべきだが、CloudFront の `errorResponses` でカスタム 404 ページを返しつつステータスコードを制御できる。用途に応じて `responseHttpStatus` を `404` に変更してもよい。

## まとめ

| レイヤー | 技術 | 役割 |
|---------|------|------|
| フレームワーク | Next.js (`output: "export"`) | 静的 HTML 生成 |
| インフラ定義 | AWS CDK | S3 + CloudFront をコードで管理 |
| ストレージ | S3 (非公開) | ビルド成果物のホスティング |
| CDN | CloudFront + OAC | HTTPS 配信 + URL リライト |
| CI/CD | GitHub Actions + OIDC | push トリガーの自動デプロイ |

この構成のメリットは、**インフラもパイプラインもすべてコードとしてリポジトリに含まれる**こと。環境を壊しても `cdk deploy` と `git push` で完全に再現できる。

## バイブコーディングで実装する

この記事の内容を AI コーディングアシスタントに実装させるためのプロンプト例:

> Next.js のブログサイトを AWS にデプロイする CI/CD パイプラインを構築して。要件は以下の通り:
>
> - Next.js は `output: "export"` で静的エクスポートする
> - インフラは AWS CDK v2 で定義する。S3（パブリックアクセス全ブロック）+ CloudFront（OAC）構成
> - CloudFront Function で URL リライトを実装する（拡張子なし URL に `.html` を付与、`/_next/` や画像パスはスキップ）
> - GitHub Actions で main ブランチへの push をトリガーにビルド → S3 sync → CloudFront キャッシュ無効化
> - AWS 認証は OIDC（`aws-actions/configure-aws-credentials` の `role-to-assume`）を使う。アクセスキーは使わない
> - S3 バケット名、CloudFront Distribution ID、IAM Role ARN は GitHub Secrets で管理

### エージェントに指示するときの注意点

- **CDK と GitHub Actions を一度に指示すると混乱しやすい**。まず CDK でインフラを定義させ、出力値を確認してから GitHub Actions のワークフローを作らせると確実
- **OIDC の IAM ロール設定は CDK に含めるか別管理か**を明示する。記事では CDK スタック外で設定する前提だが、含めたい場合はその旨を伝える
- **CloudFront Function のリライトルール**は、サイトのルーティング構造に依存する。RSS (`/feed.xml`) やサイトマップなどの拡張子付きパスがある場合、スキップ条件に追加が必要
