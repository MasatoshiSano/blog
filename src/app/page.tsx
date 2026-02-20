import {
  getPaginatedPosts,
  getAllCategories,
  getAllTags,
  getFeaturedPosts,
} from "@/lib/posts";
import { ArticleList } from "@/components/articles/ArticleList";
import { HeroSection } from "@/components/articles/HeroSection";
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
  const heroPost = featuredPosts[0];
  const remainingPosts = heroPost
    ? posts.filter((p) => p.slug !== heroPost.slug)
    : posts;

  return (
    <>
      {heroPost && <HeroSection post={heroPost} />}
      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <ArticleList posts={remainingPosts} />
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
