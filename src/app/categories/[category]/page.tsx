import type { Metadata } from "next";
import {
  getPostsByCategory,
  getAllCategories,
  getAllTags,
  getFeaturedPosts,
} from "@/lib/posts";
import { ArticleList } from "@/components/articles/ArticleList";
import { Sidebar } from "@/components/layout/Sidebar";
import { CategoryList } from "@/components/sidebar/CategoryList";
import { TagList } from "@/components/sidebar/TagList";
import { FeaturedArticles } from "@/components/sidebar/FeaturedArticles";

interface CategoryPageProps {
  params: Promise<{ category: string }>;
}

export function generateStaticParams() {
  return getAllCategories().map((cat) => ({ category: cat.name }));
}

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { category } = await params;
  return {
    title: `${decodeURIComponent(category)} の記事`,
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { category } = await params;
  const decodedCategory = decodeURIComponent(category);
  const posts = getPostsByCategory(decodedCategory);
  const categories = getAllCategories();
  const tags = getAllTags();
  const featuredPosts = getFeaturedPosts();

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">
          <span className="text-gray-400">カテゴリ:</span> {decodedCategory}
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
