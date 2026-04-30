"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FileText, Trash2, Pencil, Plus, RefreshCw, CheckCircle, Clock } from "lucide-react";
import { listPosts, deletePost, type PostListItem } from "@/lib/admin-api";

export default function PostsPage() {
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPosts();
      setPosts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "記事の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  async function handleDelete(slug: string, title: string) {
    if (!window.confirm(`「${title}」を削除してよろしいですか？\nこの操作は取り消せません。`)) {
      return;
    }
    setDeletingSlug(slug);
    setDeletedMessage(null);
    try {
      await deletePost(slug);
      setPosts((prev) => prev.filter((p) => p.slug !== slug));
      setDeletedMessage(`「${title}」を削除しました。再ビルドが開始されました（1〜3分で反映）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingSlug(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">記事一覧</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            公開・下書き含む全記事を管理します
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchPosts}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            更新
          </button>
          <Link
            href="/admin/upload"
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
          >
            <Plus size={14} />
            新規投稿
          </Link>
        </div>
      </div>

      {deletedMessage && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          {deletedMessage}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 py-16 dark:border-gray-700">
          <FileText size={40} className="mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500 dark:text-gray-400">記事がありません</p>
          <Link
            href="/admin/upload"
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
          >
            <Plus size={14} />
            最初の記事を投稿する
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50">
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">タイトル</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">カテゴリ</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">日付</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
              {posts.map((post) => (
                <tr key={post.slug} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="shrink-0 text-gray-400" />
                      <span className="font-medium text-gray-900 dark:text-white">{post.title}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">{post.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                      {post.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{post.date}</td>
                  <td className="px-4 py-3">
                    {post.published ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <CheckCircle size={12} />
                        公開中
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                        <Clock size={12} />
                        下書き
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/admin/edit?slug=${encodeURIComponent(post.slug)}`}
                        className="rounded-lg p-1.5 text-gray-400 opacity-0 transition hover:bg-primary-50 hover:text-primary-600 group-hover:opacity-100 dark:hover:bg-primary-900/20 dark:hover:text-primary-400"
                        aria-label={`「${post.title}」を編集`}
                      >
                        <Pencil size={14} />
                      </Link>
                      <button
                        onClick={() => handleDelete(post.slug, post.title)}
                        disabled={deletingSlug === post.slug}
                        className="rounded-lg p-1.5 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        aria-label={`「${post.title}」を削除`}
                      >
                        {deletingSlug === post.slug ? (
                          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
