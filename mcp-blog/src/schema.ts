import { z } from "zod";

// API リクエスト/レスポンスの zod スキーマ (api/src/schema.ts と対応)

export const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "slug must be alphanumeric with - or _");

// blog_preview_post ツール入力
export const PreviewToolInputSchema = z.object({
  markdown: z
    .string()
    .min(1)
    .max(5 * 1024 * 1024)
    .describe("Markdown content of the post (including frontmatter)"),
  slug: SlugSchema.optional().describe(
    "Optional slug hint for Unsplash image selection"
  ),
  imageMeta: z
    .object({
      filename: z.string(),
      contentType: z.string(),
    })
    .optional()
    .describe("Optional image metadata for presign URL"),
});

// blog_publish_post ツール入力
export const PublishToolInputSchema = z.object({
  slug: SlugSchema.describe("URL slug for the post (alphanumeric, hyphens, underscores)"),
  markdown: z
    .string()
    .min(1)
    .max(5 * 1024 * 1024)
    .describe("Finalized Markdown content (after preview correction)"),
  frontmatter: z
    .object({
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
    })
    .describe("Validated frontmatter object"),
});

// blog_list_posts ツール入力
export const ListToolInputSchema = z.object({
  published: z
    .boolean()
    .optional()
    .describe("Filter by published status (omit for all)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of posts to return (default: 20)"),
});

// blog_delete_post ツール入力
export const DeleteToolInputSchema = z.object({
  slug: SlugSchema.describe("Slug of the post to delete"),
});

// blog_get_post ツール入力
export const GetToolInputSchema = z.object({
  slug: SlugSchema.describe("Slug of the post to fetch"),
});

export type PreviewToolInput = z.infer<typeof PreviewToolInputSchema>;
export type PublishToolInput = z.infer<typeof PublishToolInputSchema>;
export type ListToolInput = z.infer<typeof ListToolInputSchema>;
export type DeleteToolInput = z.infer<typeof DeleteToolInputSchema>;
export type GetToolInput = z.infer<typeof GetToolInputSchema>;
