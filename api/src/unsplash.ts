import unsplashImagesJson from "../data/unsplash-images.json" with { type: "json" };
import type { UnsplashImage } from "./types.js";

// src/lib/unsplash.ts と同じ djb2 ハッシュ。
function hashSlug(slug: string): number {
  let hash = 5381;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) + hash + slug.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function optimizeUnsplashUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("w", "800");
    u.searchParams.set("fm", "webp");
    u.searchParams.set("q", "75");
    u.searchParams.set("auto", "format");
    return u.toString();
  } catch {
    return url;
  }
}

export function getUnsplashImageForSlug(slug: string): UnsplashImage | null {
  const images = unsplashImagesJson as UnsplashImage[];
  if (images.length === 0) return null;
  const picked = images[hashSlug(slug) % images.length];
  return { ...picked, url: optimizeUnsplashUrl(picked.url) };
}
