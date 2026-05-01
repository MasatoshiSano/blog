import { notFound } from "next/navigation";
import {
  getPaginatedPosts,
  getAllCategories,
  getAllTags,
  getFeaturedPosts,
} from "@/lib/posts";
import { ArticleList } from "@/components/articles/ArticleList";
import { Pagination } from "@/components/ui/Pagination";
import { Sidebar } from "@/components/layout/Sidebar";
import { CategoryList } from "@/components/sidebar/CategoryList";
import { TagList } from "@/components/sidebar/TagList";
import { FeaturedArticles } from "@/components/sidebar/FeaturedArticles";

export function generateStaticParams() {
  const { totalPages } = getPaginatedPosts(1);
  // ページ 1 は / で配信されるため、2..totalPages のみ生成
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => ({
    page: String(i + 2),
  }));
}

export default async function PaginatedPage({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page } = await params;
  const pageNum = Number.parseInt(page, 10);
  if (!Number.isFinite(pageNum) || pageNum < 2) {
    notFound();
  }

  const { posts, totalPages, currentPage } = getPaginatedPosts(pageNum);
  if (currentPage > totalPages || posts.length === 0) {
    notFound();
  }

  const categories = getAllCategories();
  const tags = getAllTags();
  const featuredPosts = getFeaturedPosts();

  return (
    <>
      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <ArticleList posts={posts} />
          <Pagination currentPage={currentPage} totalPages={totalPages} basePath="" />
        </div>
        <Sidebar>
          <CategoryList categories={categories} />
          <TagList tags={tags} />
          <FeaturedArticles posts={featuredPosts} />
        </Sidebar>
      </div>
    </>
  );
}
