"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  getPostMarkdown,
  publishPost,
} from "@/lib/admin-api";

export default function EditPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      }
    >
      <EditPageInner />
    </Suspense>
  );
}

function EditPageInner() {
  const searchParams = useSearchParams();
  const slug = searchParams?.get("slug") ?? "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editedMarkdown, setEditedMarkdown] = useState("");
  const [editedFrontmatter, setEditedFrontmatter] = useState<
    Record<string, unknown>
  >({});

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    if (!slug) {
      setLoadError("URL に ?slug=... を指定してください");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getPostMarkdown(slug);
      setEditedMarkdown(data.markdown);
      setEditedFrontmatter(data.frontmatter);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "記事の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePublish() {
    if (!slug) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await publishPost({
        slug,
        markdown: editedMarkdown,
        frontmatter: editedFrontmatter,
      });
      setDone(true);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setPublishing(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center dark:border-green-800 dark:bg-green-900/20">
          <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
          <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">更新しました</h1>
          <p className="mb-1 text-sm text-gray-600 dark:text-gray-400">
            記事 <code className="rounded bg-green-100 px-1 dark:bg-green-900/40">{slug}</code> を上書き保存しました。
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            GitHub Actions のビルドが完了すると 1〜3 分後に反映されます。
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/admin/posts"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              記事一覧へ
            </Link>
            <button
              onClick={() => setDone(false)}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
            >
              続けて編集
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500" />
          <p className="mb-4 text-sm text-red-700 dark:text-red-400">{loadError}</p>
          <Link
            href="/admin/posts"
            className="inline-block rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            記事一覧へ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/admin/posts"
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="記事一覧へ戻る"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">記事を編集</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            slug: <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">{slug}</code>
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">フロントマター</h2>
          <div className="space-y-3">
            {Object.entries(editedFrontmatter).map(([key, value]) => (
              <div key={key}>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{key}</label>
                {typeof value === "boolean" ? (
                  <button
                    onClick={() =>
                      setEditedFrontmatter((prev) => ({ ...prev, [key]: !value }))
                    }
                    className={`rounded-full px-3 py-0.5 text-xs font-medium transition ${
                      value
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    {value ? "true" : "false"}
                  </button>
                ) : typeof value === "number" ? (
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setEditedFrontmatter((prev) => ({
                        ...prev,
                        [key]: raw === "" ? "" : Number(raw),
                      }));
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                ) : Array.isArray(value) ? (
                  <input
                    type="text"
                    value={(value as string[]).join(", ")}
                    onChange={(e) =>
                      setEditedFrontmatter((prev) => ({
                        ...prev,
                        [key]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      }))
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    placeholder="カンマ区切りで入力"
                  />
                ) : (
                  <input
                    type="text"
                    value={String(value ?? "")}
                    onChange={(e) =>
                      setEditedFrontmatter((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Markdown 本文</h2>
          <textarea
            value={editedMarkdown}
            onChange={(e) => setEditedMarkdown(e.target.value)}
            rows={20}
            className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </section>
      </div>

      {publishError && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {publishError}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <Link
          href="/admin/posts"
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          キャンセル
        </Link>
        <button
          onClick={handlePublish}
          disabled={publishing}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
        >
          {publishing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <CheckCircle size={16} />
          )}
          {publishing ? "更新中..." : "更新する"}
        </button>
      </div>
    </div>
  );
}
