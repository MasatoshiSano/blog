import Link from "next/link";
import Image from "next/image";
import { icons, FileText, type LucideIcon } from "lucide-react";
import type { Post } from "@/types/post";
import { getUnsplashImageForSlug } from "@/lib/unsplash";

function kebabToPascal(str: string): string {
  return str.replace(/(^\w|-\w)/g, (m) => m.replace("-", "").toUpperCase());
}

function getPostIcon(post: Post): LucideIcon {
  if (post.icon) {
    const name = kebabToPascal(post.icon);
    return (name in icons ? icons[name as keyof typeof icons] : FileText) as LucideIcon;
  }
  return FileText;
}

interface ArticleCardProps {
  post: Post;
  variant?: "card" | "list";
}

export function ArticleCard({ post, variant = "card" }: ArticleCardProps) {
  const unsplashImage = !post.coverImage ? getUnsplashImageForSlug(post.slug) : null;
  const Icon = getPostIcon(post);

  if (variant === "list") {
    return (
      <article className="group border-b border-gray-100 py-5 last:border-0 dark:border-gray-800">
        <Link href={`/posts/${post.slug}`} className="flex gap-4">
          <div className="relative size-28 shrink-0 overflow-hidden rounded-xl sm:size-32">
            {post.coverImage ? (
              <Image src={post.coverImage} alt={post.title} fill className="object-cover transition-transform duration-500 group-hover:scale-105" />
            ) : unsplashImage ? (
              <>
                <Image src={unsplashImage.url} alt={post.title} fill className="object-cover transition-transform duration-500 group-hover:scale-105" />
                <span className="absolute bottom-0.5 right-1 text-[9px] text-white/50 drop-shadow">
                  {unsplashImage.photographer} / Unsplash
                </span>
              </>
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900">
                <Icon size={32} className="text-gray-400 dark:text-gray-500" />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div>
              <h2 className="mb-1 line-clamp-3 text-base font-bold leading-snug text-gray-900 group-hover:text-primary-600 dark:text-white dark:group-hover:text-primary-400 sm:text-lg">
                {post.title}
              </h2>
              {post.description && (
                <p className="line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{post.description}</p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{post.category}</span>
              <time dateTime={post.date} className="text-xs text-gray-400 dark:text-gray-500">{post.date}</time>
              <span className="text-xs text-gray-400 dark:text-gray-500">{post.readingTime}分</span>
            </div>
          </div>
        </Link>
      </article>
    );
  }

  return (
    <article className="group overflow-hidden rounded-xl border border-gray-200 bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900">
      <Link href={`/posts/${post.slug}`} className="block">
        {post.coverImage ? (
          <div className="relative aspect-video w-full overflow-hidden">
            <Image src={post.coverImage} alt={post.title} fill className="object-cover transition-transform duration-500 group-hover:scale-105" />
          </div>
        ) : unsplashImage ? (
          <div className="relative aspect-video w-full overflow-hidden">
            <Image src={unsplashImage.url} alt={post.title} fill className="object-cover transition-transform duration-500 group-hover:scale-105" />
            <span className="absolute bottom-1 right-1 text-[10px] text-white/60 drop-shadow">
              {unsplashImage.photographer} / Unsplash
            </span>
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900"><Icon size={48} className="text-gray-400 dark:text-gray-500" /></div>
        )}
        <div className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{post.category}</span>
            <time dateTime={post.date} className="text-xs text-gray-500 dark:text-gray-400">{post.date}</time>
            <span className="text-xs text-gray-500 dark:text-gray-400">{post.readingTime}分</span>
          </div>
          <h2 className="mb-2 text-lg font-semibold leading-snug text-gray-900 group-hover:text-primary-600 dark:text-white dark:group-hover:text-primary-400">{post.title}</h2>
          {post.description && (
            <p className="mb-3 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{post.description}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {post.topics.map((topic) => (
              <span key={topic} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">{topic}</span>
            ))}
          </div>
        </div>
      </Link>
    </article>
  );
}
