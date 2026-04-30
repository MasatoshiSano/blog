#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BlogStack } from "../lib/blog-stack";

const app = new cdk.App();

// 既存 GitHub Actions OIDC ロール ARN は CDK context から取得 (任意)。
//   npx cdk deploy -c githubActionsRoleArn=arn:aws:iam::123456789012:role/GitHubActions
// もしくは cdk.json の context に記述。未指定なら追加権限の attach はスキップされる。
const githubActionsRoleArn = app.node.tryGetContext("githubActionsRoleArn") as
  | string
  | undefined;

new BlogStack(app, "BlogStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
  },
  githubActionsRoleArn,
});
