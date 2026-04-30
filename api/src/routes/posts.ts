import path from "node:path";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import matter from "gray-matter";
import {
  PreviewRequestSchema,
  PublishRequestSchema,
  SlugSchema,
} from "../schema.js";
import { parseJsonBody } from "../util/parse.js";
import { json, error } from "../util/response.js";
import { correctPostWithAi } from "../ai/client.js";
import { getUnsplashImageForSlug } from "../unsplash.js";
import {
  putMarkdown,
  deleteMarkdown,
  listPostKeys,
  getMarkdown,
} from "../s3.js";
import { triggerDispatch } from "../github.js";
import type { ApiSecrets } from "../ssm.js";

interface RouteContext {
  secrets: ApiSecrets;
  contentBucket: string;
  githubRepo: string; // "owner/repo"
}

// path traversal 対策: src/lib/posts.ts の path.basename パターンを踏襲。
function sanitizeSlug(slug: string): string {
  return path.basename(slug);
}

export async function handlePostsPreview(
  event: APIGatewayProxyEvent,
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody(event);
  const parsed = PreviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return error(400, "invalid request", parsed.error.issues);
  }

  const ai = await correctPostWithAi(parsed.data.markdown, ctx.secrets.anthropicKey);
  const slug = parsed.data.slug
    ? sanitizeSlug(parsed.data.slug)
    : slugFromTitle(ai.frontmatter.title);
  const unsplash = getUnsplashImageForSlug(slug);

  return json({
    slug,
    frontmatter: ai.frontmatter,
    correctedMarkdown: ai.correctedMarkdown,
    diff: ai.diff,
    unsplashSuggestion: unsplash,
  });
}

export async function handlePostsPublish(
  event: APIGatewayProxyEvent,
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody(event);
  const parsed = PublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return error(400, "invalid request", parsed.error.issues);
  }
  const slug = sanitizeSlug(parsed.data.slug);
  if (slug !== parsed.data.slug) {
    return error(400, "invalid slug");
  }

  const fm = parsed.data.frontmatter;
  const markdownWithFrontmatter = matter.stringify(parsed.data.markdown, fm);
  await putMarkdown(ctx.contentBucket, slug, markdownWithFrontmatter);

  if (ctx.githubRepo && ctx.secrets.githubDispatchToken) {
    await triggerDispatch({
      repo: ctx.githubRepo,
      token: ctx.secrets.githubDispatchToken,
      eventType: "blog-rebuild",
      clientPayload: { slug },
    });
  }

  return json({
    slug,
    deployingAt: new Date().toISOString(),
    estimatedReady: "1-3 minutes",
  });
}

export async function handlePostsList(
  _event: APIGatewayProxyEvent,
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const keys = await listPostKeys(ctx.contentBucket);
  const items = await Promise.all(
    keys.map(async (key) => {
      const slug = path.basename(key, ".md");
      const content = await getMarkdown(ctx.contentBucket, slug);
      if (!content) return null;
      try {
        const { data } = matter(content);
        return {
          slug,
          title: (data.title as string | undefined) ?? slug,
          date: (data.date as string | undefined) ?? "",
          category: (data.category as string | undefined) ?? "",
          published: (data.published as boolean | undefined) ?? false,
        };
      } catch {
        return { slug, title: slug, date: "", category: "", published: false };
      }
    })
  );
  return json({ posts: items.filter((i) => i !== null) });
}

export async function handlePostsDelete(
  event: APIGatewayProxyEvent,
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const slugParam = event.pathParameters?.slug;
  if (!slugParam) {
    return error(400, "slug path parameter required");
  }
  const validation = SlugSchema.safeParse(slugParam);
  if (!validation.success) {
    return error(400, "invalid slug");
  }
  const slug = sanitizeSlug(validation.data);
  if (slug !== validation.data) {
    return error(400, "invalid slug");
  }

  await deleteMarkdown(ctx.contentBucket, slug);
  if (ctx.githubRepo && ctx.secrets.githubDispatchToken) {
    await triggerDispatch({
      repo: ctx.githubRepo,
      token: ctx.secrets.githubDispatchToken,
      eventType: "blog-rebuild",
      clientPayload: { slug, deleted: true },
    });
  }
  return json({ deleted: slug, deployingAt: new Date().toISOString() });
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "untitled";
}
