"use client";

import { useEffect, useRef } from "react";

interface CodeBlockProps {
  htmlContent: string;
  className?: string;
}

let mermaidInitialized = false;

export function CodeBlock({ htmlContent, className }: CodeBlockProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const controllers: AbortController[] = [];

    const wrappers =
      ref.current.querySelectorAll<HTMLElement>(".code-block-wrapper");

    wrappers.forEach((wrapper) => {
      if (wrapper.querySelector("[data-copy-btn]")) return;

      const btn = document.createElement("button");
      btn.setAttribute("data-copy-btn", "true");
      btn.textContent = "Copy";

      const controller = new AbortController();
      controllers.push(controller);

      btn.addEventListener(
        "click",
        async () => {
          const code = wrapper.querySelector("code");
          if (code) {
            await navigator.clipboard.writeText(code.textContent ?? "");
            btn.textContent = "Copied!";
            setTimeout(() => {
              btn.textContent = "Copy";
            }, 2000);
          }
        },
        { signal: controller.signal }
      );

      wrapper.appendChild(btn);
    });

    // Render Mermaid diagrams
    const mermaidBlocks =
      ref.current.querySelectorAll<HTMLElement>(".mermaid-block pre.mermaid");

    if (mermaidBlocks.length > 0) {
      import("mermaid").then((mod) => {
        const mermaid = mod.default;
        if (!mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
          mermaidInitialized = true;
        }
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

    return () => {
      for (const controller of controllers) {
        controller.abort();
      }
    };
  }, [htmlContent]);

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
