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

export function getUnsplashImageForSlug(slug: string): UnsplashImage | null {
  const images = unsplashImagesJson as UnsplashImage[];
  if (images.length === 0) return null;
  return images[hashSlug(slug) % images.length];
}
