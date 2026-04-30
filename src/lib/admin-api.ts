// 管理者 API クライアント — fetch ベース、Cookie 認証 (credentials: "include")

export interface PreviewResponse {
  originalMarkdown: string;
  correctedMarkdown: string;
  frontmatter: Record<string, unknown>;
  diff: string;
  unsplashPreviewUrl?: string;
  unsplashPhotographer?: string;
}

export interface PublishResponse {
  slug: string;
  deployingAt: string;
  estimatedReady: string;
}

export interface PostListItem {
  slug: string;
  title: string;
  date: string;
  category: string;
  published: boolean;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

const API_BASE = "/api";

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // 未認証 → ログインページへリダイレクト
    if (typeof window !== "undefined") {
      window.location.href = "/admin/login";
    }
    throw new Error("401 Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

/** パスワードでログインし、セッション Cookie を取得する */
export async function login(password: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/admin/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (res.status === 401) {
    throw new Error("パスワードが正しくありません");
  }
  if (!res.ok) {
    throw new Error(`ログインに失敗しました (${res.status})`);
  }
  return { ok: true };
}

/** Markdown + 任意の画像メタデータを送り、AI 補正プレビューを取得する */
export async function previewPost(
  markdown: string,
  imageMeta?: { filename: string; contentType: string }
): Promise<PreviewResponse> {
  return request<PreviewResponse>("/admin/posts/preview", {
    method: "POST",
    body: JSON.stringify({ markdown, imageMeta }),
  });
}

/** 確定済みペイロードを S3 に保存し、GitHub Actions 再ビルドを発火する */
export async function publishPost(payload: {
  slug: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
}): Promise<PublishResponse> {
  return request<PublishResponse>("/admin/posts/publish", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 記事一覧を取得する */
export async function listPosts(): Promise<PostListItem[]> {
  return request<PostListItem[]>("/admin/posts", { method: "GET" });
}

/** 記事を削除し、再ビルドを発火する */
export async function deletePost(slug: string): Promise<{ deleted: string; deployingAt: string }> {
  return request(`/admin/posts/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

/** 画像アップロード用の pre-signed PUT URL を取得する */
export async function getUploadUrl(
  filename: string,
  contentType: string
): Promise<UploadUrlResponse> {
  return request<UploadUrlResponse>("/admin/images/upload-url", {
    method: "POST",
    body: JSON.stringify({ filename, contentType }),
  });
}

/** pre-signed URL を使って画像を S3 に直接 PUT する */
export async function uploadImageToS3(
  uploadUrl: string,
  file: File
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!res.ok) {
    throw new Error(`画像のアップロードに失敗しました (${res.status})`);
  }
}
