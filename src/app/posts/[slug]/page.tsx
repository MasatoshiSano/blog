import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getPost,
  getAllSlugs,
  getRelatedPosts,
  getSeriesPosts,
} from "@/lib/posts";
import { markdownToHtml } from "@/lib/markdown";
import { ArticleDetail } from "@/components/articles/ArticleDetail";
import { RelatedArticles } from "@/components/articles/RelatedArticles";
import { SeriesNav } from "@/components/articles/SeriesNav";
import { ShareButtons } from "@/components/ui/ShareButtons";
import { Sidebar } from "@/components/layout/Sidebar";
import { TableOfContents } from "@/components/sidebar/TableOfContents";

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.content.slice(0, 160).replace(/[#*`\[\]]/g, ""),
  };
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const { html, headings } = await markdownToHtml(post.content);
  const relatedPosts = getRelatedPosts(post);
  const seriesPosts = post.series ? getSeriesPosts(post.series) : [];

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1">
        <ArticleDetail post={post} htmlContent={html} />
        <ShareButtons title={post.title} />
        {post.series && seriesPosts.length > 1 && (
          <SeriesNav
            series={post.series}
            posts={seriesPosts}
            currentSlug={post.slug}
          />
        )}
        {relatedPosts.length > 0 && <RelatedArticles posts={relatedPosts} />}
      </div>
      <Sidebar>
        <TableOfContents headings={headings} />
      </Sidebar>
    </div>
  );
}
