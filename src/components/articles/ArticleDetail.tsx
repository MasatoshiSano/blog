"use client";

import Link from "next/link";
import { CodeBlock } from "@/components/ui/CodeBlock";
import type { Post } from "@/types/post";

interface ArticleDetailProps {
  post: Post;
  htmlContent: string;
}

export function ArticleDetail({ post, htmlContent }: ArticleDetailProps) {
  return (
    <article>
      <header className="mb-8">
        <div className="mb-4 text-4xl">{post.emoji}</div>
        <h1 className="mb-4 text-3xl font-bold text-gray-900">{post.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <Link
            href={`/categories/${post.category}`}
            className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100"
          >
            {post.category}
          </Link>
          <time dateTime={post.date}>{post.date}</time>
          {post.updated && (
            <span className="text-gray-400">更新: {post.updated}</span>
          )}
          <span>{post.readingTime}分で読めます</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.topics.map((topic) => (
            <Link
              key={topic}
              href={`/tags/${topic}`}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 transition-colors hover:bg-gray-200"
            >
              {topic}
            </Link>
          ))}
        </div>
      </header>
      <CodeBlock
        htmlContent={htmlContent}
        className="prose prose-gray max-w-none"
      />
    </article>
  );
}
