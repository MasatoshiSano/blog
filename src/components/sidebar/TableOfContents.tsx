"use client";

import { useState, useEffect } from "react";
import type { Heading } from "@/types/post";

interface TableOfContentsProps {
  headings: Heading[];
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -80% 0px" }
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav className="pt-4 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">目次</h3>
      <ul className="space-y-1">
        {headings.map((heading) => (
          <li
            key={heading.id}
            style={{ paddingLeft: `${(heading.level - 2) * 0.75}rem` }}
          >
            <a
              href={`#${heading.id}`}
              className={`block rounded py-1 px-2 text-xs leading-relaxed transition-colors ${
                activeId === heading.id
                  ? "bg-primary-50 font-medium text-primary-700"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
