"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Fuse from "fuse.js";
import Link from "next/link";
import type { SearchIndexEntry } from "@/types/post";

interface SearchModalProps {
  searchIndex: SearchIndexEntry[];
}

export function SearchModal({ searchIndex }: SearchModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(searchIndex, {
        keys: ["title", "category", "topics", "excerpt"],
        threshold: 0.3,
      }),
    [searchIndex]
  );

  const results = query
    ? fuse.search(query, { limit: 8 }).map((r) => r.item)
    : [];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery("");
    }
  }, [isOpen]);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400"
        aria-label="検索を開く"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="hidden sm:inline">検索</span>
        <kbd className="hidden sm:inline-block rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
          ⌘K
        </kbd>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          onClick={() => setIsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="記事検索"
        >
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center border-b border-gray-200 px-4 dark:border-gray-700">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 text-gray-400 dark:text-gray-500"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="記事を検索..."
                className="w-full bg-transparent px-3 py-4 text-base outline-none dark:text-white dark:placeholder-gray-500"
              />
              <button
                onClick={() => setIsOpen(false)}
                className="shrink-0 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500"
              >
                ESC
              </button>
            </div>

            {query && (
              <div className="max-h-80 overflow-y-auto p-2">
                {results.length > 0 ? (
                  <ul>
                    {results.map((item) => (
                      <li key={item.slug}>
                        <Link
                          href={`/posts/${item.slug}`}
                          onClick={() => setIsOpen(false)}
                          className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <div className="font-medium text-gray-900 dark:text-white">
                            {item.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                            <span className="rounded bg-primary-50 px-1.5 py-0.5 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                              {item.category}
                            </span>
                            {item.topics.slice(0, 3).map((topic) => (
                              <span key={topic}>{topic}</span>
                            ))}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    &ldquo;{query}&rdquo;に一致する記事が見つかりませんでした
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
