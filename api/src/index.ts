import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { loadApiSecrets, type ApiSecrets } from "./ssm.js";
import { authenticate } from "./auth/middleware.js";
import { error, json } from "./util/response.js";
import { handleLogin } from "./routes/login.js";
import {
  handlePostsPreview,
  handlePostsPublish,
  handlePostsList,
  handlePostsGet,
  handlePostsDelete,
} from "./routes/posts.js";
import { handleImagesPresign } from "./routes/images.js";

// Cold start 時のみシークレットをロードしてプロセス内で再利用。
let cachedSecrets: ApiSecrets | null = null;
async function getSecrets(): Promise<ApiSecrets> {
  if (cachedSecrets) return cachedSecrets;
  const prefix = process.env.PARAMETER_STORE_PREFIX ?? "/blog/api";
  cachedSecrets = await loadApiSecrets(prefix);
  return cachedSecrets;
}

// テスト用 reset。
export function __resetSecretsCacheForTest(): void {
  cachedSecrets = null;
}

function getEnv(): {
  contentBucket: string;
  mediaBucket: string;
  githubRepo: string;
} {
  return {
    contentBucket: process.env.CONTENT_BUCKET ?? "",
    mediaBucket: process.env.MEDIA_BUCKET ?? "",
    githubRepo: process.env.GITHUB_DISPATCH_REPO ?? "",
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const method = (event.httpMethod ?? "").toUpperCase();
    const rawPath = event.path ?? "";
    // CloudFront 経由は /api/admin/... 直接 API GW は /admin/...
    const normalizedPath = rawPath.replace(/^\/api/, "");

    // 全エンドポイント JSON 応答前提のため、ヘルスチェック以外は OPTIONS 来ない想定
    // (CORS は API Gateway の defaultCorsPreflightOptions で処理される)。
    if (method === "OPTIONS") {
      return { statusCode: 204, headers: {}, body: "" };
    }

    const secrets = await getSecrets();
    const env = getEnv();

    // login のみ未認証で受ける
    if (normalizedPath === "/admin/login" && method === "POST") {
      return await handleLogin(event, secrets);
    }

    // それ以外の /admin/* は認証必須
    if (!normalizedPath.startsWith("/admin/")) {
      return error(404, "not found");
    }
    const auth = await authenticate(event, secrets);
    if (!auth) {
      return error(401, "unauthorized");
    }

    // ルーティング
    const ctx = {
      secrets,
      contentBucket: env.contentBucket,
      githubRepo: env.githubRepo,
    };

    if (normalizedPath === "/admin/posts" && method === "GET") {
      return await handlePostsList(event, ctx);
    }
    if (normalizedPath === "/admin/posts/preview" && method === "POST") {
      return await handlePostsPreview(event, ctx);
    }
    if (normalizedPath === "/admin/posts/publish" && method === "POST") {
      return await handlePostsPublish(event, ctx);
    }
    if (
      method === "GET" &&
      /^\/admin\/posts\/[^/]+$/.test(normalizedPath) &&
      !normalizedPath.endsWith("/preview") &&
      !normalizedPath.endsWith("/publish")
    ) {
      return await handlePostsGet(event, ctx);
    }
    if (
      method === "DELETE" &&
      /^\/admin\/posts\/[^/]+$/.test(normalizedPath) &&
      !normalizedPath.endsWith("/preview") &&
      !normalizedPath.endsWith("/publish")
    ) {
      return await handlePostsDelete(event, ctx);
    }
    if (normalizedPath === "/admin/images/upload-url" && method === "POST") {
      return await handleImagesPresign(event, { mediaBucket: env.mediaBucket });
    }

    return error(404, "not found");
  } catch (err) {
    console.error("handler error:", err);
    const message = err instanceof Error ? err.message : "internal error";
    return json({ error: "internal error", message }, { statusCode: 500 });
  }
}
