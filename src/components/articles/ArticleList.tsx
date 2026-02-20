"use client";

import { useState, useEffect } from "react";
import { ArticleCard } from "./ArticleCard";
import { ColumnToggle } from "@/components/ui/ColumnToggle";
import type { Post } from "@/types/post";

interface ArticleListProps {
  posts: Post[];
}

const STORAGE_KEY = "blog-columns";

export function ArticleList({ posts }: ArticleListProps) {
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = Number(saved);
      if (parsed >= 1 && parsed <= 3) setColumns(parsed);
    }
  }, []);

  const handleColumnsChange = (cols: number) => {
    setColumns(cols);
    localStorage.setItem(STORAGE_KEY, String(cols));
  };

  const gridClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-1 md:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">{posts.length}件の記事</p>
        <ColumnToggle columns={columns} onChange={handleColumnsChange} />
      </div>
      <div className={`grid gap-6 ${gridClass}`}>
        {posts.map((post) => (
          <ArticleCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
