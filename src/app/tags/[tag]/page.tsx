import type { Metadata } from "next";
import {
  getPostsByTag,
  getAllCategories,
  getAllTags,
  getFeaturedPosts,
} from "@/lib/posts";
import { ArticleList } from "@/components/articles/ArticleList";
import { Sidebar } from "@/components/layout/Sidebar";
import { CategoryList } from "@/components/sidebar/CategoryList";
import { TagList } from "@/components/sidebar/TagList";
import { FeaturedArticles } from "@/components/sidebar/FeaturedArticles";

interface TagPageProps {
  params: Promise<{ tag: string }>;
}

export function generateStaticParams() {
  return getAllTags().map((tag) => ({ tag }));
}

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const { tag } = await params;
  return {
    title: `${decodeURIComponent(tag)} の記事`,
  };
}

export default async function TagPage({ params }: TagPageProps) {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const posts = getPostsByTag(decodedTag);
  const categories = getAllCategories();
  const tags = getAllTags();
  const featuredPosts = getFeaturedPosts();

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1">
        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
          <span className="text-gray-400">タグ:</span> {decodedTag}
        </h1>
        <ArticleList posts={posts} />
      </div>
      <Sidebar>
        <CategoryList categories={categories} />
        <TagList tags={tags} />
        <FeaturedArticles posts={featuredPosts} />
      </Sidebar>
    </div>
  );
}
