"use client";

import { useEffect, useRef } from "react";

interface CodeBlockProps {
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

    // Render Mermaid diagrams
    const mermaidBlocks =
      ref.current.querySelectorAll<HTMLElement>(".mermaid-block pre.mermaid");

    if (mermaidBlocks.length > 0) {
      import("mermaid").then((mod) => {
        const mermaid = mod.default;
        mermaid.initialize({ startOnLoad: false, theme: "default" });
        mermaidBlocks.forEach((block) => {
          if (block.getAttribute("data-mermaid-rendered")) return;
          block.setAttribute("data-mermaid-rendered", "true");
          const code = block.textContent ?? "";
          const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
          mermaid.render(id, code).then(({ svg }) => {
            block.innerHTML = svg;
          });
        });
      });
    }
  }, [htmlContent]);

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
