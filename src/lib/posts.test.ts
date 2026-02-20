import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  getPost,
  getAllPosts,
  getPostsByCategory,
  getPostsByTag,
  getFeaturedPosts,
  getSeriesPosts,
  getRelatedPosts,
  getAllCategories,
  getAllTags,
  getAllSlugs,
  getPaginatedPosts,
  getSearchIndex,
} from "./posts";

const TEST_POSTS_DIR = path.join(process.cwd(), "content", "posts");

// We use the actual content/posts directory since we have real posts to test against
describe("posts", () => {
  describe("getPost", () => {
    it("returns a post for a valid slug", () => {
      const post = getPost("how-to-post-blog");
      expect(post).not.toBeNull();
      expect(post!.slug).toBe("how-to-post-blog");
      expect(post!.title).toBe("このブログに記事を投稿する方法");
      expect(post!.published).toBe(true);
    });

    it("returns null for a non-existent slug", () => {
      const post = getPost("non-existent-post-slug-xyz");
      expect(post).toBeNull();
    });

    it("parses frontmatter fields correctly", () => {
      const post = getPost("how-to-post-blog");
      expect(post).not.toBeNull();
      expect(post!.emoji).toBe("📝");
      expect(post!.type).toBe("tech");
      expect(post!.topics).toEqual(["Next.js", "Markdown"]);
      expect(post!.category).toBe("Guide");
      expect(post!.date).toBe("2026-02-18");
      expect(post!.featured).toBe(true);
    });

    it("calculates reading time", () => {
      const post = getPost("how-to-post-blog");
      expect(post).not.toBeNull();
      expect(post!.readingTime).toBeGreaterThan(0);
      expect(typeof post!.readingTime).toBe("number");
    });

    it("includes raw markdown content", () => {
      const post = getPost("how-to-post-blog");
      expect(post).not.toBeNull();
      expect(post!.content).toContain("## 概要");
    });
  });

  describe("getAllPosts", () => {
    it("returns all published posts", () => {
      const posts = getAllPosts();
      expect(posts.length).toBeGreaterThan(0);
      // All returned posts should be published
      for (const post of posts) {
        expect(post.published).toBe(true);
      }
    });

    it("sorts posts by date descending (newest first)", () => {
      const posts = getAllPosts();
      for (let i = 1; i < posts.length; i++) {
        const prevDate = new Date(posts[i - 1].date).getTime();
        const currDate = new Date(posts[i].date).getTime();
        expect(prevDate).toBeGreaterThanOrEqual(currDate);
      }
    });
  });

  describe("getPostsByCategory", () => {
    it("filters posts by category", () => {
      const allPosts = getAllPosts();
      if (allPosts.length === 0) return;

      const category = allPosts[0].category;
      const filtered = getPostsByCategory(category);
      expect(filtered.length).toBeGreaterThan(0);
      for (const post of filtered) {
        expect(post.category).toBe(category);
      }
    });

    it("returns empty array for non-existent category", () => {
      const result = getPostsByCategory("NonExistentCategory123");
      expect(result).toEqual([]);
    });
  });

  describe("getPostsByTag", () => {
    it("filters posts by tag", () => {
      const allPosts = getAllPosts();
      if (allPosts.length === 0) return;

      const tag = allPosts[0].topics[0];
      const filtered = getPostsByTag(tag);
      expect(filtered.length).toBeGreaterThan(0);
      for (const post of filtered) {
        expect(post.topics).toContain(tag);
      }
    });

    it("returns empty array for non-existent tag", () => {
      const result = getPostsByTag("NonExistentTag123");
      expect(result).toEqual([]);
    });
  });

  describe("getFeaturedPosts", () => {
    it("returns only featured posts", () => {
      const featured = getFeaturedPosts();
      for (const post of featured) {
        expect(post.featured).toBe(true);
      }
    });
  });

  describe("getSeriesPosts", () => {
    it("returns posts from a specific series sorted by seriesOrder", () => {
      const allPosts = getAllPosts();
      const seriesPost = allPosts.find((p) => p.series);
      if (!seriesPost) return; // skip if no series posts exist

      const seriesPosts = getSeriesPosts(seriesPost.series!);
      expect(seriesPosts.length).toBeGreaterThan(0);
      for (const post of seriesPosts) {
        expect(post.series).toBe(seriesPost.series);
      }
      // Verify sorting by seriesOrder
      for (let i = 1; i < seriesPosts.length; i++) {
        expect(seriesPosts[i - 1].seriesOrder ?? 0).toBeLessThanOrEqual(
          seriesPosts[i].seriesOrder ?? 0
        );
      }
    });
  });

  describe("getRelatedPosts", () => {
    it("returns posts related by category and topics", () => {
      const allPosts = getAllPosts();
      if (allPosts.length < 2) return;

      const current = allPosts[0];
      const related = getRelatedPosts(current);
      // Should not include the current post itself
      for (const post of related) {
        expect(post.slug).not.toBe(current.slug);
      }
    });

    it("respects the limit parameter", () => {
      const allPosts = getAllPosts();
      if (allPosts.length < 2) return;

      const related = getRelatedPosts(allPosts[0], 2);
      expect(related.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getAllCategories", () => {
    it("returns categories with counts sorted by count descending", () => {
      const categories = getAllCategories();
      expect(categories.length).toBeGreaterThan(0);
      for (const cat of categories) {
        expect(cat.name).toBeTruthy();
        expect(cat.count).toBeGreaterThan(0);
      }
      // Verify sorting
      for (let i = 1; i < categories.length; i++) {
        expect(categories[i - 1].count).toBeGreaterThanOrEqual(categories[i].count);
      }
    });
  });

  describe("getAllTags", () => {
    it("returns sorted unique tags", () => {
      const tags = getAllTags();
      expect(tags.length).toBeGreaterThan(0);
      // Verify sorted
      const sorted = [...tags].sort();
      expect(tags).toEqual(sorted);
      // Verify unique
      expect(new Set(tags).size).toBe(tags.length);
    });
  });

  describe("getAllSlugs", () => {
    it("returns slugs for all markdown files", () => {
      const slugs = getAllSlugs();
      expect(slugs.length).toBeGreaterThan(0);
      for (const slug of slugs) {
        expect(slug).not.toContain(".md");
      }
    });
  });

  describe("getPaginatedPosts", () => {
    it("returns paginated results", () => {
      const result = getPaginatedPosts(1);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBeGreaterThanOrEqual(1);
      expect(result.posts.length).toBeGreaterThan(0);
      expect(result.posts.length).toBeLessThanOrEqual(12);
    });

    it("returns empty for out-of-range page", () => {
      const result = getPaginatedPosts(999);
      expect(result.posts).toEqual([]);
      expect(result.currentPage).toBe(999);
    });
  });

  describe("getSearchIndex", () => {
    it("returns search index entries with required fields", () => {
      const index = getSearchIndex();
      expect(index.length).toBeGreaterThan(0);
      for (const entry of index) {
        expect(entry.slug).toBeTruthy();
        expect(entry.title).toBeTruthy();
        expect(entry.category).toBeTruthy();
        expect(Array.isArray(entry.topics)).toBe(true);
        expect(typeof entry.excerpt).toBe("string");
      }
    });

    it("strips markdown syntax from excerpts", () => {
      const index = getSearchIndex();
      for (const entry of index) {
        // Should not contain markdown formatting characters
        expect(entry.excerpt).not.toMatch(/[#*`\[\]]/);
      }
    });

    it("limits excerpt length to 200 characters", () => {
      const index = getSearchIndex();
      for (const entry of index) {
        expect(entry.excerpt.length).toBeLessThanOrEqual(200);
      }
    });
  });
});
