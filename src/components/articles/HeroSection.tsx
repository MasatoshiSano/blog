import Link from "next/link";
import Image from "next/image";
import type { Post } from "@/types/post";
import { getUnsplashImageForSlug } from "@/lib/unsplash";

interface HeroSectionProps {
  post: Post;
}

export function HeroSection({ post }: HeroSectionProps) {
  const unsplashImage = !post.coverImage ? getUnsplashImageForSlug(post.slug) : null;
  const imageSrc = post.coverImage ?? unsplashImage?.url;

  return (
    <section className="mb-10 animate-fade-in-up">
      <Link
        href={`/posts/${post.slug}`}
        className="group block overflow-hidden rounded-2xl border border-gray-200 bg-white transition-all hover:shadow-lg dark:border-gray-800 dark:bg-gray-900"
      >
        {imageSrc ? (
          <div className="relative aspect-[21/9] w-full overflow-hidden">
            <Image
              src={imageSrc}
              alt={post.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-primary-500 px-3 py-0.5 text-xs font-semibold">Featured</span>
                <span className="rounded-full bg-white/20 px-3 py-0.5 text-xs backdrop-blur-sm">{post.category}</span>
              </div>
              <h2 className="mb-2 text-2xl font-bold leading-tight md:text-3xl">{post.title}</h2>
              {post.description && (
                <p className="mb-3 line-clamp-2 text-sm text-gray-200 md:text-base">{post.description}</p>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <time dateTime={post.date}>{post.date}</time>
                  <span>{post.readingTime}分で読めます</span>
                </div>
                {unsplashImage && (
                  <span className="text-[10px] text-white/50 drop-shadow">
                    {unsplashImage.photographer} / Unsplash
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-primary-500 px-3 py-0.5 text-xs font-semibold text-white">Featured</span>
              <span className="rounded-full bg-primary-50 px-3 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{post.category}</span>
            </div>
            <div className="mb-3 text-4xl">{post.emoji}</div>
            <h2 className="mb-2 text-2xl font-bold text-gray-900 group-hover:text-primary-600 md:text-3xl dark:text-white dark:group-hover:text-primary-400">{post.title}</h2>
            {post.description && (
              <p className="mb-3 text-gray-600 dark:text-gray-400">{post.description}</p>
            )}
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <time dateTime={post.date}>{post.date}</time>
              <span>{post.readingTime}分で読めます</span>
            </div>
          </div>
        )}
      </Link>
    </section>
  );
}
