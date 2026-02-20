import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { createHighlighter } from "shiki";
import type { Heading } from "@/types/post";

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [
        "typescript",
        "javascript",
        "tsx",
        "jsx",
        "html",
        "css",
        "json",
        "bash",
        "shell",
        "python",
        "rust",
        "go",
        "yaml",
        "markdown",
        "sql",
        "diff",
      ],
    });
  }
  return highlighterPromise;
}

/**
 * Preprocess Qiita-style :::note blocks into HTML.
 *
 * Supports:
 *   :::note info    (blue info box)
 *   :::note warn    (yellow warning box)
 *   :::note alert   (red alert box)
 *   :::note         (defaults to info)
 */
function preprocessNoteBlocks(markdown: string): string {
  const noteRegex = /^:::note\s*(info|warn|alert)?\s*\n([\s\S]*?)^:::\s*$/gm;
  return markdown.replace(noteRegex, (_match, type: string | undefined, content: string) => {
    const noteType = type ?? "info";
    const iconMap: Record<string, string> = {
      info: "ℹ️",
      warn: "⚠️",
      alert: "🚫",
    };
    const icon = iconMap[noteType] ?? "ℹ️";
    const trimmed = content.trim();
    return `<div class="qiita-note qiita-note-${noteType}"><span class="qiita-note-icon">${icon}</span>\n<div class="qiita-note-content">\n\n${trimmed}\n\n</div>\n</div>`;
  });
}

function extractHeadings(html: string): Heading[] {
  const headings: Heading[] = [];
  const regex = /<h([2-3])\s+id="([^"]+)"[^>]*>(.*?)<\/h[2-3]>/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1], 10),
      id: match[2],
      text: match[3].replace(/<[^>]+>/g, ""),
    });
  }

  return headings;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
};

// Matches named entities (&lt; &gt; &amp; &quot;), decimal (&#60;), and hex (&#x3C;)
const HTML_ENTITY_RE = /&(?:#x([0-9a-fA-F]+)|#(\d+)|[a-zA-Z]+);/g;

function decodeHtmlEntities(text: string): string {
  return text.replace(HTML_ENTITY_RE, (entity, hex, dec) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return HTML_ENTITY_MAP[entity] ?? entity;
  });
}

async function highlightCode(html: string): Promise<string> {
  const highlighter = await getHighlighter();
  const codeBlockRegex =
    /<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g;

  return html.replace(codeBlockRegex, (_match, lang, code) => {
    const decodedCode = decodeHtmlEntities(code);

    const language = lang ?? "text";

    // Mermaid blocks: wrap for client-side rendering instead of syntax highlighting
    if (language === "mermaid") {
      return `<div class="mermaid-block"><pre class="mermaid">${decodedCode.trim()}</pre></div>`;
    }

    try {
      const highlighted = highlighter.codeToHtml(decodedCode.trim(), {
        lang: language,
        theme: "github-dark",
      });
      const langLabel = `<span class="code-language">${language}</span>`;
      return `<div class="code-block-wrapper" data-language="${language}">${langLabel}${highlighted}</div>`;
    } catch {
      return `<div class="code-block-wrapper" data-language="${language}"><pre><code>${code}</code></pre></div>`;
    }
  });
}

export async function markdownToHtml(
  markdown: string
): Promise<{ html: string; headings: Heading[] }> {
  // Preprocess Qiita-style note blocks
  const preprocessed = preprocessNoteBlocks(markdown);

  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(preprocessed);

  let html = result.toString();
  html = await highlightCode(html);

  const headings = extractHeadings(html);

  return { html, headings };
}
