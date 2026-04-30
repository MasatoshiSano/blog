// REST API クライアント — fetch + BLOG_API_KEY ヘッダ

export interface ApiClientConfig {
  endpoint: string;
  apiKey: string;
}

export interface PreviewResponse {
  correctedMarkdown: string;
  correctedFrontmatter: Record<string, unknown>;
  diff: Record<string, unknown>;
  unsplashImageUrl?: string;
}

export interface PublishResponse {
  slug: string;
  deployingAt: string;
  estimatedReady: string;
}

export interface ListPost {
  slug: string;
  title: string;
  date: string;
  category: string;
  published: boolean;
}

export interface DeleteResponse {
  deleted: string;
  deployingAt: string;
}

export interface PresignResponse {
  uploadUrl: string;
  key: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getConfig(): ApiClientConfig {
  const endpoint = process.env.BLOG_API_ENDPOINT;
  const apiKey = process.env.BLOG_API_KEY;
  if (!endpoint) {
    throw new Error("BLOG_API_ENDPOINT 環境変数が設定されていません");
  }
  if (!apiKey) {
    throw new Error("BLOG_API_KEY 環境変数が設定されていません");
  }
  return { endpoint: endpoint.replace(/\/$/, ""), apiKey };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const config = getConfig();
  const url = `${config.endpoint}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      // JSON パース失敗は無視
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

export async function previewPost(
  markdown: string,
  slug?: string,
  imageMeta?: { filename: string; contentType: string }
): Promise<PreviewResponse> {
  return request<PreviewResponse>("POST", "/admin/posts/preview", {
    markdown,
    slug,
    imageMeta,
  });
}

export async function publishPost(payload: {
  slug: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
}): Promise<PublishResponse> {
  return request<PublishResponse>("POST", "/admin/posts/publish", payload);
}

export async function listPosts(
  published?: boolean,
  limit?: number
): Promise<ListPost[]> {
  const params = new URLSearchParams();
  if (published !== undefined) params.set("published", String(published));
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  return request<ListPost[]>("GET", `/admin/posts${query ? `?${query}` : ""}`);
}

export async function deletePost(slug: string): Promise<DeleteResponse> {
  return request<DeleteResponse>("DELETE", `/admin/posts/${encodeURIComponent(slug)}`);
}
