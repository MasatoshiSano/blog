import { z } from "zod";

// PostFrontmatter の zod スキーマ。preview 段階では緩く、publish 段階では strict 検証する。
export const PostFrontmatterStrict = z.object({
  title: z.string().min(1).max(200),
  icon: z.string().min(1).max(50),
  type: z.enum(["tech", "idea"]),
  topics: z.array(z.string().min(1).max(50)).min(1).max(10),
  published: z.boolean(),
  category: z.string().min(1).max(50),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  featured: z.boolean().optional(),
  series: z.string().max(100).optional(),
  seriesOrder: z.number().int().min(1).max(100).optional(),
  coverImage: z.string().url().optional(),
  description: z.string().max(500).optional(),
  // 旧 emoji は publish 時に許容するが推奨しない (移行期間)。
  emoji: z.string().max(10).optional(),
});

export const PostFrontmatterLoose = PostFrontmatterStrict.partial().extend({
  title: z.string().min(1).max(200),
});

// Slug は path traversal 対策のため英数 + ハイフン + アンダースコアに制限。
export const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "slug must be alphanumeric with - or _");

export const PreviewRequestSchema = z.object({
  markdown: z.string().min(1).max(5 * 1024 * 1024), // 5MB
  slug: SlugSchema.optional(),
  imageMeta: z
    .object({
      filename: z.string(),
      contentType: z.string(),
    })
    .optional(),
});

export const PublishRequestSchema = z.object({
  slug: SlugSchema,
  markdown: z.string().min(1).max(5 * 1024 * 1024),
  frontmatter: PostFrontmatterStrict,
});

export const LoginRequestSchema = z.object({
  password: z.string().min(1).max(200),
});

export const DeleteRequestSchema = z.object({
  slug: SlugSchema,
});

export const PresignRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z
    .string()
    .regex(/^image\/(png|jpeg|jpg|webp|gif)$/, "contentType must be image/*"),
});

export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type DeleteRequest = z.infer<typeof DeleteRequestSchema>;
export type PresignRequest = z.infer<typeof PresignRequestSchema>;
