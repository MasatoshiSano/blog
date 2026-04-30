import { z } from "zod";
import {
  PreviewToolInputSchema,
  PublishToolInputSchema,
  ListToolInputSchema,
  DeleteToolInputSchema,
  GetToolInputSchema,
  type PreviewToolInput,
  type PublishToolInput,
  type ListToolInput,
  type DeleteToolInput,
  type GetToolInput,
} from "./schema.js";
import {
  previewPost,
  publishPost,
  listPosts,
  deletePost,
  getPost,
  ApiError,
} from "./client.js";

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return `API エラー (${err.status}): ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// blog_preview_post: markdown を AI 補正してプレビューを返す
export async function handlePreviewPost(rawInput: unknown): Promise<string> {
  const input = PreviewToolInputSchema.parse(rawInput) as PreviewToolInput;
  try {
    const result = await previewPost(input.markdown, input.slug, input.imageMeta);
    const output = {
      correctedMarkdown: result.correctedMarkdown,
      correctedFrontmatter: result.correctedFrontmatter,
      diff: result.diff,
      ...(result.unsplashImageUrl
        ? { unsplashImageUrl: result.unsplashImageUrl }
        : {}),
    };
    return JSON.stringify(output, null, 2);
  } catch (err) {
    throw new Error(formatError(err));
  }
}

// blog_publish_post: 確定済み markdown と frontmatter を S3 に保存してビルド発火
export async function handlePublishPost(rawInput: unknown): Promise<string> {
  const input = PublishToolInputSchema.parse(rawInput) as PublishToolInput;
  try {
    const result = await publishPost({
      slug: input.slug,
      markdown: input.markdown,
      frontmatter: input.frontmatter as Record<string, unknown>,
    });
    return JSON.stringify(result, null, 2);
  } catch (err) {
    throw new Error(formatError(err));
  }
}

// blog_list_posts: 記事一覧を取得する
export async function handleListPosts(rawInput: unknown): Promise<string> {
  const input = ListToolInputSchema.parse(rawInput) as ListToolInput;
  try {
    const posts = await listPosts(input.published, input.limit);
    if (posts.length === 0) {
      return "記事が見つかりませんでした。";
    }
    return JSON.stringify(posts, null, 2);
  } catch (err) {
    throw new Error(formatError(err));
  }
}

// blog_get_post: 指定スラグの記事の Markdown と frontmatter を取得 (編集用)
export async function handleGetPost(rawInput: unknown): Promise<string> {
  const input = GetToolInputSchema.parse(rawInput) as GetToolInput;
  try {
    const result = await getPost(input.slug);
    return JSON.stringify(result, null, 2);
  } catch (err) {
    throw new Error(formatError(err));
  }
}

// blog_delete_post: 指定スラグの記事を削除してビルド発火
export async function handleDeletePost(rawInput: unknown): Promise<string> {
  const input = DeleteToolInputSchema.parse(rawInput) as DeleteToolInput;
  try {
    const result = await deletePost(input.slug);
    return JSON.stringify(result, null, 2);
  } catch (err) {
    throw new Error(formatError(err));
  }
}

// MCP ツール定義 (Server.setRequestHandler に渡す inputSchema 用)
export const toolDefinitions = [
  {
    name: "blog_preview_post",
    description:
      "AI によるフロントマター補完・本文構造補正を実行してプレビュー結果を返す。publish 前に必ず呼ぶこと。",
    inputSchema: zodToJsonSchema(PreviewToolInputSchema),
  },
  {
    name: "blog_publish_post",
    description:
      "AI 補正済みの markdown と frontmatter を S3 に保存し、GitHub Actions ビルドを発火させて公開する。",
    inputSchema: zodToJsonSchema(PublishToolInputSchema),
  },
  {
    name: "blog_list_posts",
    description: "ブログ記事の一覧を取得する。published フィルタと件数上限を指定可能。",
    inputSchema: zodToJsonSchema(ListToolInputSchema),
  },
  {
    name: "blog_get_post",
    description:
      "指定したスラグの記事を S3 から読み出し、Markdown 本体と frontmatter を返す。編集ワークフロー (取得→修正→blog_publish_post で上書き) で使う。",
    inputSchema: zodToJsonSchema(GetToolInputSchema),
  },
  {
    name: "blog_delete_post",
    description:
      "指定したスラグの記事を S3 から削除し、GitHub Actions ビルドを発火させる。",
    inputSchema: zodToJsonSchema(DeleteToolInputSchema),
  },
];

// zod スキーマを MCP が期待する JSON Schema オブジェクトに変換するシンプルな実装
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(value);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  return { type: "object" };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(field.unwrap());
  }
  if (field instanceof z.ZodString) {
    const schema: Record<string, unknown> = { type: "string" };
    const desc = field.description;
    if (desc) schema.description = desc;
    return schema;
  }
  if (field instanceof z.ZodNumber) {
    return { type: "number", ...(field.description ? { description: field.description } : {}) };
  }
  if (field instanceof z.ZodBoolean) {
    return { type: "boolean", ...(field.description ? { description: field.description } : {}) };
  }
  if (field instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodFieldToJsonSchema(field.element),
      ...(field.description ? { description: field.description } : {}),
    };
  }
  if (field instanceof z.ZodObject) {
    return zodToJsonSchema(field);
  }
  if (field instanceof z.ZodEnum) {
    return { type: "string", enum: field.options };
  }
  return {};
}
