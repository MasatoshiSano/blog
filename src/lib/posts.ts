import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";
import type {
  Post,
  PostFrontmatter,
  CategoryCount,
  SearchIndexEntry,
} from "@/types/post";

const POSTS_DIR = path.join(process.cwd(), "content", "posts");
const POSTS_PER_PAGE = 12;

function getPostFiles(): string[] {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR)
    .filter((file) => file.endsWith(".md"));
}

export function getPost(slug: string): Post | null {
  const filePath = path.join(POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(fileContent);
  const frontmatter = data as PostFrontmatter;

  if (!frontmatter.published) return null;

  const stats = readingTime(content);

  return {
    slug,
    ...frontmatter,
    content,
    readingTime: Math.ceil(stats.minutes),
  };
}

export function getAllPosts(): Post[] {
  const files = getPostFiles();

  const posts = files
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      return getPost(slug);
    })
    .filter((post): post is Post => post !== null);

  return posts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function getPostsByCategory(category: string): Post[] {
  return getAllPosts().filter((post) => post.category === category);
}

export function getPostsByTag(tag: string): Post[] {
  return getAllPosts().filter((post) => post.topics.includes(tag));
}

export function getFeaturedPosts(): Post[] {
  return getAllPosts().filter((post) => post.featured);
}

export function getSeriesPosts(series: string): Post[] {
  return getAllPosts()
    .filter((post) => post.series === series)
    .sort((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0));
}

export function getRelatedPosts(currentPost: Post, limit = 4): Post[] {
  const allPosts = getAllPosts().filter((p) => p.slug !== currentPost.slug);

  const scored = allPosts.map((post) => {
    let score = 0;
    if (post.category === currentPost.category) score += 2;
    const commonTopics = post.topics.filter((t) =>
      currentPost.topics.includes(t)
    );
    score += commonTopics.length;
    return { post, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.post);
}

export function getAllCategories(): CategoryCount[] {
  const posts = getAllPosts();
  const categoryMap = new Map<string, number>();

  for (const post of posts) {
    const count = categoryMap.get(post.category) ?? 0;
    categoryMap.set(post.category, count + 1);
  }

  return Array.from(categoryMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function getAllTags(): string[] {
  const posts = getAllPosts();
  const tagSet = new Set<string>();

  for (const post of posts) {
    for (const topic of post.topics) {
      tagSet.add(topic);
    }
  }

  return Array.from(tagSet).sort();
}

export function getAllSlugs(): string[] {
  return getPostFiles().map((file) => file.replace(/\.md$/, ""));
}

export function getPaginatedPosts(page: number): {
  posts: Post[];
  totalPages: number;
  currentPage: number;
} {
  const allPosts = getAllPosts();
  const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE);
  const start = (page - 1) * POSTS_PER_PAGE;
  const posts = allPosts.slice(start, start + POSTS_PER_PAGE);

  return { posts, totalPages, currentPage: page };
}

export function getSearchIndex(): SearchIndexEntry[] {
  return getAllPosts().map((post) => ({
    slug: post.slug,
    title: post.title,
    category: post.category,
    topics: post.topics,
    excerpt: post.content.slice(0, 200).replace(/[#*`\[\]]/g, ""),
  }));
}
