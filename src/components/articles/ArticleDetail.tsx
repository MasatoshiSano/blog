"use client";

import Link from "next/link";
import Image from "next/image";
import { CodeBlock } from "@/components/ui/CodeBlock";
import type { Post } from "@/types/post";

interface ArticleDetailProps {
  post: Post;
  htmlContent: string;
}

export function ArticleDetail({ post, htmlContent }: ArticleDetailProps) {
  return (
    <article className="animate-fade-in-up">
      {post.coverImage && (
        <div className="relative -mx-4 mb-8 aspect-[21/9] overflow-hidden rounded-2xl sm:mx-0">
          <Image src={post.coverImage} alt={post.title} fill className="object-cover" priority />
        </div>
      )}
      <header className="mb-8">
        {!post.coverImage && <div className="mb-4 text-4xl">{post.emoji}</div>}
        <h1 className="mb-4 text-3xl font-bold text-gray-900 dark:text-white">{post.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <Link href={`/categories/${post.category}`} className="rounded-full bg-primary-50 px-3 py-0.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50">
            {post.category}
          </Link>
          <time dateTime={post.date}>{post.date}</time>
          {post.updated && <span className="text-gray-400 dark:text-gray-500">更新: {post.updated}</span>}
          <span>{post.readingTime}分で読めます</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.topics.map((topic) => (
            <Link key={topic} href={`/tags/${topic}`} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700">
              {topic}
            </Link>
          ))}
        </div>
      </header>
      <CodeBlock htmlContent={htmlContent} className="prose prose-gray max-w-none dark:prose-invert" />
    </article>
  );
}
