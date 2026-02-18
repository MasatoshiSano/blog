import Link from "next/link";
import type { Post } from "@/types/post";

interface SeriesNavProps {
  series: string;
  posts: Post[];
  currentSlug: string;
}

export function SeriesNav({ series, posts, currentSlug }: SeriesNavProps) {
  const currentIndex = posts.findIndex((p) => p.slug === currentSlug);
  const prevPost = currentIndex > 0 ? posts[currentIndex - 1] : null;
  const nextPost =
    currentIndex < posts.length - 1 ? posts[currentIndex + 1] : null;

  if (!prevPost && !nextPost) return null;

  return (
    <nav className="mt-8 rounded-lg border border-gray-200 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-500">
        シリーズ: {series} ({currentIndex + 1}/{posts.length})
      </h3>
      <div className="flex justify-between gap-4">
        {prevPost ? (
          <Link
            href={`/posts/${prevPost.slug}`}
            className="flex-1 rounded-lg border border-gray-200 p-3 text-sm transition-colors hover:bg-gray-50"
          >
            <span className="text-xs text-gray-400">前の記事</span>
            <div className="mt-1 font-medium text-gray-700">
              {prevPost.emoji} {prevPost.title}
            </div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {nextPost ? (
          <Link
            href={`/posts/${nextPost.slug}`}
            className="flex-1 rounded-lg border border-gray-200 p-3 text-right text-sm transition-colors hover:bg-gray-50"
          >
            <span className="text-xs text-gray-400">次の記事</span>
            <div className="mt-1 font-medium text-gray-700">
              {nextPost.title} {nextPost.emoji}
            </div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </nav>
  );
}
