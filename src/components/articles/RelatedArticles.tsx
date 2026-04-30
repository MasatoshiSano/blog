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

interface RelatedArticlesProps {
  posts: Post[];
}

export function RelatedArticles({ posts }: RelatedArticlesProps) {
  if (posts.length === 0) return null;

  return (
    <section className="mt-12 border-t border-gray-200 pt-8 dark:border-gray-800">
      <h2 className="mb-6 text-xl font-bold text-gray-900 dark:text-white">関連記事</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map((post) => {
          const Icon = getPostIcon(post);
          return (
            <Link
              key={post.slug}
              href={`/posts/${post.slug}`}
              className="rounded-lg border border-gray-200 p-4 transition-shadow hover:shadow-md dark:border-gray-800"
            >
              <div className="mb-2 text-primary-600 dark:text-primary-400">
                <Icon className="h-7 w-7" aria-hidden="true" />
              </div>
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
          );
        })}
      </div>
    </section>
  );
}
