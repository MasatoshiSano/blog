export interface PostFrontmatter {
  title: string;
  emoji: string;
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

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export interface Post extends PostFrontmatter {
  slug: string;
  content: string;
  readingTime: number;
}

export interface PostWithHtml extends Post {
  htmlContent: string;
  headings: Heading[];
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface SearchIndexEntry {
  slug: string;
  title: string;
  category: string;
  topics: string[];
  excerpt: string;
}
