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

// 一覧カードは ~400px、ヒーロー/詳細は ~1200px。一覧が大半なので 800px + WebP +
// q=75 に揃えると、フルサイズ 1080px JPEG 比でファイルサイズが半分以下になり、
// Unsplash CDN へのリクエスト数も同じだが体感速度が大きく改善する。
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
