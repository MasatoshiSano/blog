import { describe, it, expect } from "vitest";
import {
  PostFrontmatterStrict,
  SlugSchema,
  PreviewRequestSchema,
  PublishRequestSchema,
  PresignRequestSchema,
} from "../src/schema.js";

describe("schema", () => {
  describe("SlugSchema", () => {
    it("accepts valid slugs", () => {
      expect(SlugSchema.safeParse("hello-world").success).toBe(true);
      expect(SlugSchema.safeParse("my_post_2026").success).toBe(true);
    });
    it("rejects path traversal attempts", () => {
      expect(SlugSchema.safeParse("../etc/passwd").success).toBe(false);
      expect(SlugSchema.safeParse("foo/bar").success).toBe(false);
      expect(SlugSchema.safeParse("foo.md").success).toBe(false);
    });
    it("rejects empty / overlong", () => {
      expect(SlugSchema.safeParse("").success).toBe(false);
      expect(SlugSchema.safeParse("a".repeat(101)).success).toBe(false);
    });
  });

  describe("PostFrontmatterStrict", () => {
    const valid = {
      title: "サンプル",
      icon: "code",
      type: "tech" as const,
      topics: ["react", "typescript"],
      published: true,
      category: "Web開発",
      date: "2026-04-30",
    };
    it("accepts a complete frontmatter", () => {
      expect(PostFrontmatterStrict.safeParse(valid).success).toBe(true);
    });
    it("rejects missing required fields", () => {
      const { title, ...withoutTitle } = valid;
      expect(PostFrontmatterStrict.safeParse(withoutTitle).success).toBe(false);
    });
    it("rejects bad date format", () => {
      expect(
        PostFrontmatterStrict.safeParse({ ...valid, date: "2026/04/30" }).success
      ).toBe(false);
    });
    it("rejects invalid type enum", () => {
      expect(
        PostFrontmatterStrict.safeParse({ ...valid, type: "blog" }).success
      ).toBe(false);
    });
  });

  describe("PreviewRequestSchema", () => {
    it("accepts minimal request", () => {
      expect(
        PreviewRequestSchema.safeParse({ markdown: "# hello" }).success
      ).toBe(true);
    });
    it("rejects oversized markdown (> 5MB)", () => {
      expect(
        PreviewRequestSchema.safeParse({
          markdown: "x".repeat(5 * 1024 * 1024 + 1),
        }).success
      ).toBe(false);
    });
  });

  describe("PublishRequestSchema", () => {
    it("requires slug, markdown, frontmatter", () => {
      expect(
        PublishRequestSchema.safeParse({
          slug: "my-post",
          markdown: "# hi",
          frontmatter: {
            title: "t",
            icon: "code",
            type: "tech",
            topics: ["x"],
            published: false,
            category: "c",
            date: "2026-04-30",
          },
        }).success
      ).toBe(true);
    });
  });

  describe("PresignRequestSchema", () => {
    it("rejects non-image content types", () => {
      expect(
        PresignRequestSchema.safeParse({
          filename: "x.exe",
          contentType: "application/octet-stream",
        }).success
      ).toBe(false);
    });
    it("accepts image content types", () => {
      expect(
        PresignRequestSchema.safeParse({
          filename: "x.png",
          contentType: "image/png",
        }).success
      ).toBe(true);
    });
  });
});
