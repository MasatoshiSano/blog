"use client";

import { useEffect, useRef } from "react";

interface CodeBlockProps {
  // HTML content from markdown pipeline (trusted, generated at build time from local .md files)
  htmlContent: string;
  className?: string;
}

export function CodeBlock({ htmlContent, className }: CodeBlockProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const wrappers =
      ref.current.querySelectorAll<HTMLElement>(".code-block-wrapper");

    wrappers.forEach((wrapper) => {
      if (wrapper.querySelector("[data-copy-btn]")) return;

      const btn = document.createElement("button");
      btn.setAttribute("data-copy-btn", "true");
      btn.textContent = "Copy";
      btn.className =
        "absolute top-2 right-2 rounded border border-gray-200 bg-white/80 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-white";

      btn.addEventListener("click", async () => {
        const code = wrapper.querySelector("code");
        if (code) {
          await navigator.clipboard.writeText(code.textContent ?? "");
          btn.textContent = "Copied!";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 2000);
        }
      });

      wrapper.appendChild(btn);
    });
  }, [htmlContent]);

  // Content is generated from local markdown files via the build-time markdown pipeline
  // (remark/rehype/shiki), not from user input - safe to render as HTML
  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
