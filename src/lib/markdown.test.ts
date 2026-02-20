import { describe, it, expect } from "vitest";
import { markdownToHtml } from "./markdown";

describe("markdownToHtml", () => {
  describe("basic markdown rendering", () => {
    it("renders paragraphs", async () => {
      const { html } = await markdownToHtml("Hello world");
      expect(html).toContain("<p>Hello world</p>");
    });

    it("renders headings with IDs for table of contents", async () => {
      const { html, headings } = await markdownToHtml("## My Heading\n\n### Sub Heading");
      expect(html).toContain('<h2 id="my-heading"');
      expect(html).toContain("My Heading");
      expect(headings).toHaveLength(2);
      expect(headings[0]).toEqual({ level: 2, id: "my-heading", text: "My Heading" });
      expect(headings[1]).toEqual({ level: 3, id: "sub-heading", text: "Sub Heading" });
    });

    it("extracts h2 and h3 headings only", async () => {
      const { headings } = await markdownToHtml(
        "# H1\n\n## H2\n\n### H3\n\n#### H4"
      );
      // extractHeadings only captures h2 and h3
      const levels = headings.map((h) => h.level);
      expect(levels.every((l) => l === 2 || l === 3)).toBe(true);
    });
  });

  describe("HTML entity decoding in code blocks", () => {
    it("decodes entities so Shiki can parse generics like Array<string>", async () => {
      const md = "```typescript\nconst a: Array<string> = [];\n```";
      const { html } = await markdownToHtml(md);
      // Shiki should successfully parse the TypeScript including the generic type.
      // Shiki re-encodes < as &#x3C; in its output HTML (correct HTML behavior),
      // but the key point is it received decoded source and highlighted it properly.
      expect(html).toContain("Array");
      expect(html).toContain("string");
      expect(html).toContain('data-language="typescript"');
      expect(html).toContain("shiki");
    });

    it("decodes &lt; and &gt; to < and >", async () => {
      const md = "```html\n<div>Hello</div>\n```";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("div");
      expect(html).not.toContain("&lt;");
      expect(html).not.toContain("&gt;");
    });

    it("decodes &amp; to &", async () => {
      const md = '```typescript\nconst x = a && b;\n```';
      const { html } = await markdownToHtml(md);
      expect(html).not.toContain("&amp;&amp;");
    });

    it("decodes &quot; and &#39; in code blocks", async () => {
      const md = '```typescript\nconst s = "hello\'world";\n```';
      const { html } = await markdownToHtml(md);
      expect(html).not.toContain("&quot;");
      expect(html).not.toContain("&#39;");
    });
  });

  describe("Qiita :::note block preprocessing", () => {
    it("converts :::note info blocks to styled HTML", async () => {
      const md = ":::note info\nThis is info.\n:::";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("qiita-note-info");
      expect(html).toContain("qiita-note-icon");
      expect(html).toContain("This is info.");
    });

    it("converts :::note warn blocks", async () => {
      const md = ":::note warn\nBe careful!\n:::";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("qiita-note-warn");
      expect(html).toContain("Be careful!");
    });

    it("converts :::note alert blocks", async () => {
      const md = ":::note alert\nDanger!\n:::";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("qiita-note-alert");
      expect(html).toContain("Danger!");
    });

    it("defaults to info when no type is specified", async () => {
      const md = ":::note\nDefault note.\n:::";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("qiita-note-info");
      expect(html).toContain("Default note.");
    });

    it("handles multiple note blocks in one document", async () => {
      const md = [
        ":::note info",
        "Info block.",
        ":::",
        "",
        ":::note warn",
        "Warn block.",
        ":::",
      ].join("\n");
      const { html } = await markdownToHtml(md);
      expect(html).toContain("qiita-note-info");
      expect(html).toContain("qiita-note-warn");
    });
  });

  describe("Mermaid code block handling", () => {
    it("wraps mermaid blocks in mermaid-block div instead of syntax highlighting", async () => {
      const md = '```mermaid\ngraph TD\n    A --> B\n```';
      const { html } = await markdownToHtml(md);
      expect(html).toContain('class="mermaid-block"');
      expect(html).toContain('class="mermaid"');
      expect(html).toContain("graph TD");
      // Should not have code-block-wrapper (that's for syntax-highlighted blocks)
      expect(html).not.toContain("code-block-wrapper");
    });
  });

  describe("code language detection and highlighting", () => {
    it("adds language label and wrapper for known languages", async () => {
      const md = "```typescript\nconst x = 1;\n```";
      const { html } = await markdownToHtml(md);
      expect(html).toContain('data-language="typescript"');
      expect(html).toContain('class="code-language"');
      expect(html).toContain("typescript");
    });

    it("falls back gracefully for unknown languages", async () => {
      const md = "```unknownlang\nsome code\n```";
      const { html } = await markdownToHtml(md);
      // Should still wrap in code-block-wrapper but fall back to raw code
      expect(html).toContain("code-block-wrapper");
      expect(html).toContain("some code");
    });

    it("handles code blocks without language specifier", async () => {
      const md = "```\nplain code\n```";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("plain code");
    });
  });

  describe("GFM (GitHub Flavored Markdown)", () => {
    it("renders tables", async () => {
      const md = "| A | B |\n|---|---|\n| 1 | 2 |";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("<table>");
      expect(html).toContain("<td>1</td>");
    });

    it("renders strikethrough", async () => {
      const md = "~~deleted~~";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("<del>deleted</del>");
    });

    it("renders task lists", async () => {
      const md = "- [ ] unchecked\n- [x] checked";
      const { html } = await markdownToHtml(md);
      expect(html).toContain('type="checkbox"');
    });
  });

  describe("Math / KaTeX rendering", () => {
    it("renders inline math", async () => {
      const md = "The formula is $E = mc^2$.";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("katex");
    });

    it("renders block math", async () => {
      const md = "$$\n\\sum_{i=1}^{n} x_i\n$$";
      const { html } = await markdownToHtml(md);
      expect(html).toContain("katex");
    });
  });
});
