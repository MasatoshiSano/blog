---
title: "AWS CDKでインフラをコード管理する — TypeScriptで始めるIaC入門"
emoji: "☁️"
type: "tech"
topics: ["AWS", "CDK", "TypeScript"]
published: true
category: "Infrastructure"
date: "2025-01-05"
featured: false
description: "AWS CDKを使ってTypeScriptでインフラを定義・デプロイする方法を紹介。CloudFormationとの違い、基本概念、初めてのスタック作成まで。"
---

## AWS CDKとは

AWS Cloud Development Kit（CDK）は、TypeScriptやPythonなどのプログラミング言語でAWSインフラを定義できるフレームワークです。

## こんな人向け

- AWSインフラをコンソール手作業で管理していて、コード化したい
- CloudFormation（YAML/JSON）が辛く、プログラミング言語で書きたい
- TypeScriptでAWSリソースを定義・デプロイする方法を知りたい

## 基本的な使い方

### スタックの定義

```typescript
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";

export class BlogStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new s3.Bucket(this, "BlogBucket", {
      websiteIndexDocument: "index.html",
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
```

### CloudFrontの追加

S3バケットの前にCloudFrontディストリビューションを配置することで、高速なコンテンツ配信が可能になります。

```typescript
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

const distribution = new cloudfront.Distribution(this, "BlogCDN", {
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
  },
  defaultRootObject: "index.html",
});
```

## デプロイ

```bash
npx cdk deploy
```

## まとめ

CDKを使うことで、インフラの設定をコードとして管理でき、バージョン管理やレビューが可能になります。
