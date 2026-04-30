import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface BlogStackProps extends cdk.StackProps {
  /**
   * 既存の GitHub Actions OIDC ロール ARN。
   * 指定された場合、contentBucket / mediaBucket への GetObject/ListBucket 権限を attach する。
   * 未指定の場合は権限拡張をスキップ (初回 deploy 時など、ロール ARN が確定する前は省略可)。
   */
  readonly githubActionsRoleArn?: string;
}

export class BlogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: BlogStackProps) {
    super(scope, id, props);

    // S3 bucket for static site content
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // S3 bucket for media uploads (images, etc.)
    // CORS: /admin/* からの PUT (pre-signed URL 経由) と CloudFront 配信向けの GET を許可
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
    });

    // S3 bucket for Markdown content (記事本体の永続化先)
    // バージョニングを有効化し、誤上書き / 誤削除に備える
    const contentBucket = new s3.Bucket(this, "ContentBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
    });

    // SSM Parameter Store のパス prefix。Lambda 環境変数として渡す。
    // 実体のパラメータ (admin-password-hash, jwt-secret 等) は scripts/set-admin-password.mjs
    // などのオペレーション CLI から登録する想定 (CDK では作らない)。
    const parameterStorePrefix = "/blog/api";

    // API Lambda — api/ パッケージの esbuild 出力 (api/dist/index.js) を参照する。
    // デプロイ前に必ず `cd api && npm run build` を実行して dist を更新すること。
    const apiHandler = new lambda.Function(this, "ApiHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "api", "dist")),
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
        MEDIA_BUCKET: mediaBucket.bucketName,
        PARAMETER_STORE_PREFIX: parameterStorePrefix,
        GITHUB_DISPATCH_REPO: "", // 実運用時に CDK context で上書き想定
        // AWS_REGION は Lambda ランタイムが自動注入するので明示不要
      },
    });

    // S3 アクセス権限: contentBucket / mediaBucket への Put / Get / Delete / List
    contentBucket.grantReadWrite(apiHandler);
    mediaBucket.grantReadWrite(apiHandler);

    // SSM Parameter Store 読み取り権限 (/blog/api/* 配下)
    apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${parameterStorePrefix}/*`,
        ],
      })
    );

    // API Gateway REST API
    // CORS は CloudFront 経由の同一オリジン運用 (C1) が前提のため最小限。
    // 直接 API Gateway ドメインを叩く運用 (Phase 2 のローカル動作確認等) のために
    // defaultCorsPreflightOptions も付けておく。
    const restApi = new apigateway.RestApi(this, "BlogApi", {
      restApiName: "blog-admin-api",
      description: "Blog admin API (auth, posts preview/publish, image presign)",
      deployOptions: {
        stageName: "prod",
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          ...apigateway.Cors.DEFAULT_HEADERS,
          "Authorization",
          "X-Api-Key",
        ],
        allowCredentials: true,
      },
      // バイナリ (画像) は pre-signed URL でブラウザから直接 S3 PUT するため、
      // ここでは特に binaryMediaTypes を指定しない (md / JSON のみ想定)。
    });

    // 全エンドポイントを単一 Lambda にプロキシ (内部ルーティング)。
    // 構成:
    //   POST   /admin/login
    //   POST   /admin/posts/preview
    //   POST   /admin/posts/publish
    //   GET    /admin/posts
    //   DELETE /admin/posts/{slug}
    //   POST   /admin/images/upload-url
    const lambdaIntegration = new apigateway.LambdaIntegration(apiHandler, {
      proxy: true,
    });

    const adminResource = restApi.root.addResource("admin");

    const loginResource = adminResource.addResource("login");
    loginResource.addMethod("POST", lambdaIntegration);

    const postsResource = adminResource.addResource("posts");
    postsResource.addMethod("GET", lambdaIntegration);

    const postsPreviewResource = postsResource.addResource("preview");
    postsPreviewResource.addMethod("POST", lambdaIntegration);

    const postsPublishResource = postsResource.addResource("publish");
    postsPublishResource.addMethod("POST", lambdaIntegration);

    const postsSlugResource = postsResource.addResource("{slug}");
    postsSlugResource.addMethod("DELETE", lambdaIntegration);

    const imagesResource = adminResource.addResource("images");
    const imagesUploadUrlResource = imagesResource.addResource("upload-url");
    imagesUploadUrlResource.addMethod("POST", lambdaIntegration);

    // CloudFront Function to rewrite URLs (append .html for clean URLs)
    const urlRewriteFunction = new cloudfront.Function(
      this,
      "UrlRewriteFunction",
      {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // If URI ends with '/', serve index.html
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  }
  // Static asset paths - pass through without rewriting
  else if (uri.startsWith('/_next/') || uri.startsWith('/images/')) {
    // No rewrite needed
  }
  // Known non-HTML file extensions - pass through
  else if (uri.endsWith('.xml') || uri.endsWith('.ico') || uri.endsWith('.txt') || uri.endsWith('.svg') || uri.endsWith('.png') || uri.endsWith('.jpg') || uri.endsWith('.webp') || uri.endsWith('.json')) {
    // No rewrite needed
  }
  // Everything else: append .html (pages, tags like Next.js, categories)
  else if (!uri.endsWith('.html')) {
    request.uri += '.html';
  }

  return request;
}
`),
        runtime: cloudfront.FunctionRuntime.JS_2_0,
      }
    );

    // CloudFront Function: /api/* prefix を strip して API Gateway へ転送する。
    // CloudFront 経由のリクエスト URI: /api/admin/login → API Gateway は /admin/login
    // を受け取り、定義済み resource にマッチして Lambda が呼ばれる。
    const apiPrefixStripFunction = new cloudfront.Function(
      this,
      "ApiPrefixStripFunction",
      {
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
      }
    );

    // CloudFront distribution with OAC for both buckets
    // /api/* behavior は API Gateway を origin として追加 (キャッシュ無効化、全 method 許可)
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
      additionalBehaviors: {
        "/media/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        "/api/*": {
          origin: new origins.RestApiOrigin(restApi),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: apiPrefixStripFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
      defaultRootObject: "index.html",
      // 既存 BlogStack の仕様に合わせる: S3 OAC が missing object に 403 を返すため
      // 403 と 404 の両方を /404.html (status 404) にマップする。
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
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // 既存 GitHub Actions OIDC ロールに contentBucket / mediaBucket からの Sync 権限を追加
    // (deploy.yml の "Sync content from S3" ステップ用)。
    // ロール ARN が指定されている場合のみ attach。
    if (props?.githubActionsRoleArn) {
      const githubActionsRole = iam.Role.fromRoleArn(
        this,
        "GitHubActionsRole",
        props.githubActionsRoleArn,
        { mutable: true }
      );
      githubActionsRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:ListBucket"],
          resources: [
            contentBucket.bucketArn,
            `${contentBucket.bucketArn}/*`,
            mediaBucket.bucketArn,
            `${mediaBucket.bucketArn}/*`,
          ],
        })
      );
    }

    // Stack outputs
    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
      description: "S3 bucket for static site content",
    });

    new cdk.CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.bucketName,
      description: "S3 bucket for media uploads",
    });

    new cdk.CfnOutput(this, "ContentBucketName", {
      value: contentBucket.bucketName,
      description: "S3 bucket for Markdown content (versioned)",
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID",
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain name",
    });

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: restApi.url,
      description: "API Gateway invoke URL (for direct access; prefer CloudFront /api/* in production)",
    });
  }
}
