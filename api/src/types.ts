// PostFrontmatter (src/types/post.ts) と一致させる。
export interface PostFrontmatter {
  title: string;
  /** @deprecated emoji フィールドは icon (Lucide アイコン名) に移行中 */
  emoji?: string;
  icon?: string;
  type: "tech" | "idea";
  topics: string[];
  published: boolean;
  category: string;
  date: string;
  updated?: string;
  featured?: boolean;
  series?: string;
  seriesOrder?: number;
  coverImage?: string;
  description?: string;
}

export interface UnsplashImage {
  url: string;
  photographer: string;
  photographerUrl: string;
  unsplashUrl: string;
}
