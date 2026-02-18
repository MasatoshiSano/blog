import Link from "next/link";
import type { Post } from "@/types/post";

interface ArticleCardProps {
  post: Post;
}

export function ArticleCard({ post }: ArticleCardProps) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
      <Link href={`/posts/${post.slug}`} className="block">
        <div className="mb-3 text-3xl">{post.emoji}</div>
        <h2 className="mb-2 text-lg font-semibold leading-snug text-gray-900">
          {post.title}
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
            {post.category}
          </span>
          <time dateTime={post.date}>{post.date}</time>
          <span>{post.readingTime}分</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {post.topics.map((topic) => (
            <span
              key={topic}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {topic}
            </span>
          ))}
        </div>
      </Link>
    </article>
  );
}
