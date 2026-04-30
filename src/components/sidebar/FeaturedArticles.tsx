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

interface FeaturedArticlesProps {
  posts: Post[];
}

export function FeaturedArticles({ posts }: FeaturedArticlesProps) {
  if (posts.length === 0) return null;

  return (
    <div className="pt-4 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">注目の記事</h3>
      <ul className="space-y-2">
        {posts.map((post) => {
          const Icon = getPostIcon(post);
          return (
            <li key={post.slug}>
              <Link
                href={`/posts/${post.slug}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                <Icon
                  className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
                  aria-hidden="true"
                />
                <span className="truncate">{post.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
