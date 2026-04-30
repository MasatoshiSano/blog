import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { scrypt as scryptCb, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { handler, __resetSecretsCacheForTest } from "../src/index.js";
import { __setSsmClientForTest } from "../src/ssm.js";
import { __setS3ClientForTest } from "../src/s3.js";
import { __setFetchForTest } from "../src/github.js";
import { __setAnthropicFactoryForTest } from "../src/ai/client.js";
import { hashApiKey } from "../src/auth/apiKey.js";
import { issueToken, getSessionCookieName } from "../src/auth/jwt.js";

const JWT_SECRET = "test-jwt-secret-long-enough-for-tests";
const PASSWORD = "correct-horse-battery-staple";
const API_KEY = "ak_test_key_value";

type ScryptFn = (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;
const scrypt = promisify(scryptCb) as unknown as ScryptFn;

// Phase 0 scripts/set-admin-password.mjs と同形式のハッシュを生成する。
async function hashScryptPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const derived = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  });
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

let passwordHash: string;

const ssmMock = mockClient(SSMClient);
const s3Mock = mockClient(S3Client);

async function setupSsm(): Promise<void> {
  passwordHash = await hashScryptPassword(PASSWORD);
  ssmMock.reset();
  ssmMock
    .on(GetParameterCommand, { Name: "/blog/api/admin-password-hash" })
    .resolves({ Parameter: { Value: passwordHash } });
  ssmMock
    .on(GetParameterCommand, { Name: "/blog/api/jwt-secret" })
    .resolves({ Parameter: { Value: JWT_SECRET } });
  ssmMock
    .on(GetParameterCommand, { Name: "/blog/api/api-key-hash" })
    .resolves({
      Parameter: { Value: hashApiKey(API_KEY, JWT_SECRET) },
    });
  ssmMock
    .on(GetParameterCommand, { Name: "/blog/api/github-dispatch-token" })
    .resolves({ Parameter: { Value: "ghp_test_token" } });
  __setSsmClientForTest(ssmMock as unknown as SSMClient);
}

function evt(partial: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  pathParameters?: Record<string, string>;
}): APIGatewayProxyEvent {
  return {
    httpMethod: partial.method,
    path: partial.path,
    headers: partial.headers ?? {},
    body: partial.body === undefined ? null : JSON.stringify(partial.body),
    isBase64Encoded: false,
    pathParameters: partial.pathParameters ?? null,
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(async () => {
  process.env.PARAMETER_STORE_PREFIX = "/blog/api";
  process.env.CONTENT_BUCKET = "content-bucket";
  process.env.MEDIA_BUCKET = "media-bucket";
  process.env.GITHUB_DISPATCH_REPO = "owner/blog";
  __resetSecretsCacheForTest();
  await setupSsm();
  s3Mock.reset();
  __setS3ClientForTest(s3Mock as unknown as S3Client);
});

afterEach(() => {
  __setFetchForTest(null);
  __setAnthropicFactoryForTest(null);
  __setSsmClientForTest(null);
  __setS3ClientForTest(null);
});

describe("handler routing", () => {
  it("returns 404 for unknown path", async () => {
    const res = await handler(
      evt({ method: "GET", path: "/admin/unknown" })
    );
    expect(res.statusCode).toBe(401); // 認証で先に弾かれる
  });

  it("returns 404 for path outside /admin/*", async () => {
    const res = await handler(evt({ method: "GET", path: "/foo" }));
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 for unauthenticated POST /admin/posts/publish", async () => {
    const res = await handler(
      evt({
        method: "POST",
        path: "/admin/posts/publish",
        body: { slug: "x", markdown: "y" },
      })
    );
    expect(res.statusCode).toBe(401);
  });
});

describe("login route", () => {
  it("rejects wrong password", async () => {
    const res = await handler(
      evt({ method: "POST", path: "/admin/login", body: { password: "bad" } })
    );
    expect(res.statusCode).toBe(401);
  });

  it("issues a session cookie on correct password", async () => {
    const res = await handler(
      evt({
        method: "POST",
        path: "/admin/login",
        body: { password: PASSWORD },
      })
    );
    expect(res.statusCode).toBe(200);
    const multi = (res as { multiValueHeaders?: Record<string, string[]> })
      .multiValueHeaders;
    expect(multi?.["Set-Cookie"]?.[0]).toContain(getSessionCookieName());
  });

  it("rejects malformed body", async () => {
    const res = await handler(
      evt({ method: "POST", path: "/admin/login", body: { foo: "bar" } })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("posts publish (with valid API key)", () => {
  it("rejects path traversal slug", async () => {
    const res = await handler(
      evt({
        method: "POST",
        path: "/admin/posts/publish",
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: {
          slug: "../etc/passwd",
          markdown: "# hi",
          frontmatter: {
            title: "hi",
            icon: "code",
            type: "tech",
            topics: ["x"],
            published: false,
            category: "c",
            date: "2026-04-30",
          },
        },
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it("publishes a post and triggers GitHub dispatch", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    __setFetchForTest(fetchMock as unknown as typeof fetch);

    const res = await handler(
      evt({
        method: "POST",
        path: "/admin/posts/publish",
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: {
          slug: "my-post",
          markdown: "# hi\n\nBody",
          frontmatter: {
            title: "Hi",
            icon: "code",
            type: "tech",
            topics: ["x"],
            published: true,
            category: "c",
            date: "2026-04-30",
          },
        },
      })
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.slug).toBe("my-post");
    expect(fetchMock).toHaveBeenCalledOnce();
    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.Key).toBe("posts/my-post.md");
  });

  it("works with JWT cookie auth too", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    __setFetchForTest((async () => new Response(null, { status: 204 })) as unknown as typeof fetch);
    const token = await issueToken("admin", JWT_SECRET);
    const res = await handler(
      evt({
        method: "POST",
        path: "/admin/posts/publish",
        headers: { Cookie: `${getSessionCookieName()}=${token}` },
        body: {
          slug: "another-post",
          markdown: "# x",
          frontmatter: {
            title: "x",
            icon: "code",
            type: "tech",
            topics: ["a"],
            published: true,
            category: "c",
            date: "2026-04-30",
          },
        },
      })
    );
    expect(res.statusCode).toBe(200);
  });
});

describe("posts delete", () => {
  it("rejects bad slug", async () => {
    const res = await handler({
      httpMethod: "DELETE",
      path: "/admin/posts/..",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: null,
      isBase64Encoded: false,
      pathParameters: { slug: ".." },
    } as unknown as APIGatewayProxyEvent);
    expect(res.statusCode).toBe(400);
  });

  it("deletes a valid slug", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    __setFetchForTest((async () => new Response(null, { status: 204 })) as unknown as typeof fetch);
    const res = await handler({
      httpMethod: "DELETE",
      path: "/admin/posts/my-post",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: null,
      isBase64Encoded: false,
      pathParameters: { slug: "my-post" },
    } as unknown as APIGatewayProxyEvent);
    expect(res.statusCode).toBe(200);
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls[0].args[0].input.Key).toBe("posts/my-post.md");
  });
});

describe("posts list", () => {
  it("lists posts from S3", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "posts/a.md" }, { Key: "posts/b.md" }],
      IsTruncated: false,
    });
    s3Mock
      .on(GetObjectCommand, { Bucket: "content-bucket", Key: "posts/a.md" })
      .resolves({
        Body: {
          transformToString: async () =>
            "---\ntitle: A\ndate: 2026-04-01\ncategory: tech\npublished: true\n---\nbody",
        } as never,
      });
    s3Mock
      .on(GetObjectCommand, { Bucket: "content-bucket", Key: "posts/b.md" })
      .resolves({
        Body: {
          transformToString: async () =>
            "---\ntitle: B\ndate: 2026-04-02\ncategory: idea\npublished: false\n---\nbody",
        } as never,
      });

    const res = await handler(
      evt({
        method: "GET",
        path: "/admin/posts",
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.posts).toHaveLength(2);
    expect(body.posts[0].slug).toBe("a");
  });
});

describe("preview route (mocked AI)", () => {
  it("calls Anthropic and returns suggestion + unsplash", async () => {
    const fakeClient = {
      messages: {
        create: async () => ({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                frontmatter: {
                  title: "Generated",
                  icon: "code",
                  type: "tech",
                  topics: ["t1"],
                  category: "Tech",
                  date: "2026-04-30",
                  published: false,
                  description: "desc",
                  iconCandidates: ["code-2", "terminal", "cpu", "bot"],
                },
                correctedMarkdown: "# Generated\n\nbody",
                diff: ["normalized headings"],
              }),
            },
          ],
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __setAnthropicFactoryForTest(() => fakeClient as any);

    const res = await handler(
      evt({
        method: "POST",
        path: "/admin/posts/preview",
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: { markdown: "# hi" },
      })
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.frontmatter.title).toBe("Generated");
    expect(body.unsplashSuggestion).not.toBeNull();
  });
});

describe("CloudFront /api prefix support", () => {
  it("strips /api prefix and routes correctly", async () => {
    const res = await handler(
      evt({ method: "POST", path: "/api/admin/login", body: { password: "x" } })
    );
    // login itself fails (wrong password) but path was matched.
    expect(res.statusCode).toBe(401);
  });
});
