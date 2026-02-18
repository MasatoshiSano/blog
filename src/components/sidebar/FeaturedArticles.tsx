import Link from "next/link";
import type { Post } from "@/types/post";

interface FeaturedArticlesProps {
  posts: Post[];
}

export function FeaturedArticles({ posts }: FeaturedArticlesProps) {
  if (posts.length === 0) return null;

  return (
    <div className="pt-4 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">注目の記事</h3>
      <ul className="space-y-2">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link
              href={`/posts/${post.slug}`}
              className="block rounded-md px-2 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            >
              <span className="mr-1.5">{post.emoji}</span>
              {post.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
