import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import type { Construct } from "constructs";

export class BlogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for static site content
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // S3 bucket for media uploads (images, etc.)
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

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
  else if (uri.endsWith('.xml') || uri.endsWith('.ico') || uri.endsWith('.txt')) {
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

    // CloudFront distribution with OAC for both buckets
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

    // Stack outputs
    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName,
      description: "S3 bucket for static site content",
    });

    new cdk.CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.bucketName,
      description: "S3 bucket for media uploads",
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution ID",
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain name",
    });
  }
}
