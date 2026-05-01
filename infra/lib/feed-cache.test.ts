import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BlogStack } from "../lib/blog-stack";

describe("feed.xml CloudFront cache behavior (issue#8)", () => {
  function synth() {
    const app = new App();
    const stack = new BlogStack(app, "BlogTest", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    return Template.fromStack(stack);
  }

  it("Cache-Control ヘッダが Response Headers Policy で設定される", () => {
    const template = synth();
    template.hasResourceProperties(
      "AWS::CloudFront::ResponseHeadersPolicy",
      Match.objectLike({
        ResponseHeadersPolicyConfig: Match.objectLike({
          CustomHeadersConfig: Match.objectLike({
            Items: Match.arrayWith([
              Match.objectLike({
                Header: "Cache-Control",
                Value: "public, max-age=3600, stale-while-revalidate=86400",
                Override: true,
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("X-Content-Type-Options: nosniff も付与される（security-reviewer 指摘）", () => {
    synth().hasResourceProperties(
      "AWS::CloudFront::ResponseHeadersPolicy",
      Match.objectLike({
        ResponseHeadersPolicyConfig: Match.objectLike({
          CustomHeadersConfig: Match.objectLike({
            Items: Match.arrayWith([
              Match.objectLike({ Header: "X-Content-Type-Options", Value: "nosniff" }),
            ]),
          }),
        }),
      }),
    );
  });

  it("/feed.xml 専用の CachePolicy が defaultTtl 1h で作られる", () => {
    synth().hasResourceProperties(
      "AWS::CloudFront::CachePolicy",
      Match.objectLike({
        CachePolicyConfig: Match.objectLike({
          DefaultTTL: 3600,
          MinTTL: 300,
          MaxTTL: 86400,
        }),
      }),
    );
  });
});
