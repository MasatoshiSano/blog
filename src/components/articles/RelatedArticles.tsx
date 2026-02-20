import Link from "next/link";
import type { Post } from "@/types/post";

interface RelatedArticlesProps {
  posts: Post[];
}

export function RelatedArticles({ posts }: RelatedArticlesProps) {
  if (posts.length === 0) return null;

  return (
    <section className="mt-12 border-t border-gray-200 pt-8 dark:border-gray-800">
      <h2 className="mb-6 text-xl font-bold text-gray-900 dark:text-white">関連記事</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/posts/${post.slug}`}
            className="rounded-lg border border-gray-200 p-4 transition-shadow hover:shadow-md dark:border-gray-800"
          >
            <div className="mb-2 text-2xl">{post.emoji}</div>
            <h3 className="text-sm font-semibold leading-snug text-gray-900 dark:text-white">
              {post.title}
            </h3>
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="rounded bg-primary-50 px-1.5 py-0.5 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                {post.category}
              </span>
              <time dateTime={post.date}>{post.date}</time>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
