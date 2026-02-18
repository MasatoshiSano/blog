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

export default function HomePage() {
  const { posts, totalPages, currentPage } = getPaginatedPosts(1);
  const categories = getAllCategories();
  const tags = getAllTags();
  const featuredPosts = getFeaturedPosts();

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1">
        <ArticleList posts={posts} />
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          basePath=""
        />
      </div>
      <Sidebar>
        <CategoryList categories={categories} />
        <TagList tags={tags} />
        <FeaturedArticles posts={featuredPosts} />
      </Sidebar>
    </div>
  );
}
