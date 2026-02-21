import unsplashImagesJson from "@/data/unsplash-images.json";

type UnsplashImage = {
  url: string;
  photographer: string;
  photographerUrl: string;
  unsplashUrl: string;
};

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
