import Link from "next/link";
import { icons, FileText, type LucideIcon } from "lucide-react";
import type { Post } from "@/types/post";

function kebabToPascal(str: string): string {
  return str.replace(/(^\w|-\w)/g, (m) => m.replace("-", "").toUpperCase());
}

function getPostIcon(post: Post): LucideIcon {
  if (post.icon) {
    const name = kebabToPascal(post.icon);
    return (name in icons ? icons[name as keyof typeof icons] : FileText) as LucideIcon;
  }
  return FileText;
}

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

  const PrevIcon = prevPost ? getPostIcon(prevPost) : null;
  const NextIcon = nextPost ? getPostIcon(nextPost) : null;

  return (
    <nav className="mt-8 rounded-lg border border-gray-200 p-5 dark:border-gray-800">
      <h3 className="mb-4 text-sm font-semibold text-gray-500 dark:text-gray-400">
        シリーズ: {series} ({currentIndex + 1}/{posts.length})
      </h3>
      <div className="flex justify-between gap-4">
        {prevPost && PrevIcon ? (
          <Link
            href={`/posts/${prevPost.slug}`}
            className="flex-1 rounded-lg border border-gray-200 p-3 text-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
          >
            <span className="text-xs text-gray-400 dark:text-gray-500">前の記事</span>
            <div className="mt-1 flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
              <PrevIcon
                className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
                aria-hidden="true"
              />
              <span>{prevPost.title}</span>
            </div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {nextPost && NextIcon ? (
          <Link
            href={`/posts/${nextPost.slug}`}
            className="flex-1 rounded-lg border border-gray-200 p-3 text-right text-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
          >
            <span className="text-xs text-gray-400 dark:text-gray-500">次の記事</span>
            <div className="mt-1 flex items-center justify-end gap-2 font-medium text-gray-700 dark:text-gray-300">
              <span>{nextPost.title}</span>
              <NextIcon
                className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
                aria-hidden="true"
              />
            </div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </nav>
  );
}
