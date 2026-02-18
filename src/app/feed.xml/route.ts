import { Feed } from "feed";
import { getAllPosts } from "@/lib/posts";

export const dynamic = "force-static";

const SITE_URL = "https://blog.example.com";

export function GET() {
  const posts = getAllPosts();

  const feed = new Feed({
    title: "Tech Blog",
    description: "フロントエンド、バックエンド、インフラのテクノロジーブログ",
    id: SITE_URL,
    link: SITE_URL,
    language: "ja",
    copyright: `All rights reserved ${new Date().getFullYear()}`,
    updated: posts.length > 0 ? new Date(posts[0].date) : new Date(),
  });

  for (const post of posts) {
    feed.addItem({
      title: post.title,
      id: `${SITE_URL}/posts/${post.slug}`,
      link: `${SITE_URL}/posts/${post.slug}`,
      date: new Date(post.date),
      description: post.content.slice(0, 200).replace(/[#*`\[\]]/g, ""),
      category: [{ name: post.category }],
    });
  }

  return new Response(feed.rss2(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
