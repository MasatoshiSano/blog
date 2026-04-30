# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This repo contains four sibling packages, each with its own `package.json` and tsconfig:

| Path | Purpose | Build target |
|---|---|---|
| `/` (root) | Next.js static blog | `next build` → `out/` (static export) |
| `infra/` | AWS CDK app (S3 + CloudFront + Lambda + API Gateway) | `npm run build` (TS), `cdk deploy` |
| `api/` | Lambda handlers for blog admin REST API | `npm run build` (esbuild → `dist/index.js`) |
| `mcp-blog/` | MCP server wrapping `api/` for any-project Claude Code | `npm run build` (tsc → `dist/`) |

The root `tsconfig.json` excludes `infra`, `api`, and `mcp-blog`. Each subpackage's deps are isolated.

## Commands

### Root (Next.js blog)
- `npm run dev` — local Next.js dev server
- `npm run build` — production build → `out/`
- `npm run lint` — `next lint`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest single run (`src/**/*.test.ts`, node env)
- `npm run test:watch` — Vitest watch
- Single test: `npx vitest run src/lib/posts.test.ts` or `-t "<name pattern>"`
- `npm run fetch-unsplash` — repopulate `src/data/unsplash-images.json` (needs `UNSPLASH_ACCESS_KEY` in `.env.local`)

### Admin scripts (run from repo root)
- `node scripts/init-jwt-secret.mjs` — generate JWT signing key + HMAC pepper into SSM `/blog/api/jwt-secret`. Must run **before** `rotate-api-key.mjs`.
- `node scripts/set-admin-password.mjs` — interactively set the admin password; scrypt-hashed (`scrypt$<salt>$<hash>`) into `/blog/api/admin-password-hash`.
- `node scripts/rotate-api-key.mjs [--append] [--force]` — generate a new API key, store HMAC-SHA256 hash at `/blog/api/api-key-hash` (pepper = jwt-secret), print plain key once.
- `node scripts/migrate-emoji-to-icon.mjs [--apply]` — AI-driven migration of `content/posts/*.md` from `emoji:` to `icon:` (Lucide name). Default is dry-run; `--apply` writes files.

### `infra/` (CDK)
- `cd infra && npm run build` — TypeScript only check
- `cd infra && npm run cdk -- diff` — preview stack changes
- `cd infra && npm run cdk -- deploy` — deploy `BlogStack` (region `ap-northeast-1`)

### `api/` (Lambda)
- `cd api && npm install`
- `cd api && npm run typecheck`
- `cd api && npm test` — Vitest, AWS/Anthropic/fetch fully mocked
- `cd api && npm run build` — esbuild bundle into `dist/index.js`. CDK references this asset.

### `mcp-blog/` (MCP server)
- `cd mcp-blog && npm install && npm run build` → `dist/index.js` (with `#!/usr/bin/env node` shebang)
- After build, register in `~/.claude/settings.json` (see `mcp-blog/README.md`). Future plan: split into separate `sano/mcp-blog` GitHub repo so any-project users can `npx -y github:sano/mcp-blog`.

## Architecture

### Public site is a static export
The blog itself (everything under `src/app` *except* `src/app/admin/*`) is a fully static export (`output: "export"`). There is no runtime server, no API routes, no ISR. Pages, RSS, search index, and category/tag listings are generated at build time from `content/posts/*.md`.

Helpers in `src/lib/posts.ts` run during `next build`. A module-scope cache (`cachedAllPosts`) deduplicates filesystem reads across the many call sites (home page, every `[slug]`/`[category]`/`[tag]` static param generator, RSS, search index). Do not remove the cache — it is load-bearing for build time.

### Frontmatter contract (PostFrontmatter)
`src/types/post.ts` defines the schema. Required: `title`, `type` (`tech`|`idea`), `topics[]`, `published`, `category`, `date`. Optional: `updated`, `featured`, `series`, `seriesOrder`, `coverImage`, `description`, `icon` (Lucide kebab-case name), `emoji` (deprecated; kept optional during migration). Posts with `published: false` are dropped by `getPost`.

`emoji → icon` migration: components fall back from `icon` to `emoji` to `FileText` so old posts keep rendering until they are migrated. Run `scripts/migrate-emoji-to-icon.mjs --apply` to convert in-place; cover image API mirror lives in `api/data/unsplash-images.json`.

### Markdown → HTML pipeline
`src/lib/markdown.ts`: `remark-parse → remark-gfm → remark-math → remark-rehype (allowDangerousHtml) → rehype-slug → rehype-katex → rehype-stringify`, plus a post-pass that runs Shiki (`github-dark`) over `<pre><code>` blocks. Two non-standard behaviors:

- **Qiita-style note blocks**: `:::note info|warn|alert` … `:::` are preprocessed into `<div class="qiita-note ...">` HTML *before* unified runs. Adding a new variant means updating both the regex in `preprocessNoteBlocks` and the `iconMap`.
- **Mermaid blocks**: language `mermaid` bypasses Shiki; wrapped in `<div class="mermaid-block"><pre class="mermaid">…` for client-side rendering by the `mermaid` package.
- Shiki receives HTML-decoded source (`decodeHtmlEntities`) — remark-rehype escapes the code, and re-highlighting escaped text would double-escape angle brackets in TS/JSX samples.
- The Shiki highlighter is lazy-memoized (`highlighterPromise`); the `langs` allowlist is the supported set.

### Cover images
`src/lib/unsplash.ts` deterministically picks an image from `src/data/unsplash-images.json` using a djb2 hash of the slug — same post always gets the same image across builds. Posts may override with `coverImage`. The same djb2 logic is duplicated in `api/src/unsplash.ts` (Lambda cannot import from blog `src/`); keep them in sync.

### Admin upload system (added Stage 1–3)

The blog grows a write path so the author can post from any project's Claude Code via MCP. Architecture:

```
Browser /admin/upload  ─┐
                        ├─► CloudFront /api/*  ──► API Gateway  ──► Lambda (api/)
Claude Code (mcp-blog) ─┘                                          │
                                                                   ├─► S3 contentBucket (md)
                                                                   ├─► S3 mediaBucket (images, presigned PUT)
                                                                   ├─► SSM Parameter Store (secrets)
                                                                   ├─► Anthropic Claude Haiku 4.5 (frontmatter / structure correction)
                                                                   └─► GitHub repository_dispatch
                                                                          │
                                                                          ▼
                                              GitHub Actions deploy.yml ─┐
                                                                         ├─► aws s3 sync s3://contentBucket/posts/ → content/posts/
                                                                         ├─► aws s3 sync s3://mediaBucket/ → public/media/
                                                                         ├─► npm run build  (static export)
                                                                         ├─► aws s3 sync out/ → siteBucket
                                                                         └─► cloudfront create-invalidation
```

Reading tour, in dependency order:
1. **Plan + handoffs** — `.omc/plans/blog-upload-system-plan.md` (canonical plan), `.omc/handoffs/team-*.md` (decisions per stage)
2. **CDK** — `infra/lib/blog-stack.ts`. New: `contentBucket` (versioned), Lambda `apiHandler` (currently `Code.fromInline` placeholder; swap to `Code.fromAsset("../api/dist")` once `api/` is built), API Gateway REST + 6 endpoints, CloudFront `/api/*` behavior with `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` (Host header would 403 against API Gateway).
3. **API package** — `api/`. Entry `src/index.ts` is the API Gateway proxy router that strips `/api` prefix. Auth via `auth/middleware.ts` (JWT cookie OR `Authorization: Bearer` API key). Routes in `src/routes/`: `login.ts` (scrypt verify matching admin script format), `posts.ts` (preview/publish/list/delete), `images.ts` (5-min presign URL). AI in `src/ai/` (Claude Haiku 4.5 with `cache_control: ephemeral` system prompt). Secrets cold-loaded once via `src/ssm.ts`. `src/schema.ts` is the zod source of truth; `mcp-blog/src/schema.ts` mirrors it.
4. **Admin UI** — `src/app/admin/{login,upload,posts}/page.tsx` are all `"use client"` Client Components, so the static export model still works. `src/lib/admin-api.ts` is the fetch-based REST client (uses same-origin `/api/admin/...` via CloudFront).
5. **MCP server** — `mcp-blog/`. stdio transport, modern `@modelcontextprotocol/sdk` API. 4 tools: `blog_preview_post`, `blog_publish_post`, `blog_list_posts`, `blog_delete_post`. Reads `BLOG_API_ENDPOINT` and `BLOG_API_KEY` from env at call time.

### SSM Parameter Store layout (`/blog/api/*`)
Set in this order before Lambda is functional:
| Parameter | Set by | Notes |
|---|---|---|
| `/blog/api/jwt-secret` | `init-jwt-secret.mjs` | HS256 signing key + HMAC pepper for API keys |
| `/blog/api/admin-password-hash` | `set-admin-password.mjs` | `scrypt$<salt>$<hash>`; N=32768, r=8, p=1, keylen=64, maxmem=128 MiB |
| `/blog/api/api-key-hash` | `rotate-api-key.mjs` | comma-separated HMAC-SHA256 hashes (rotation friendly) |
| `/blog/api/anthropic-key` | manual | `aws ssm put-parameter ... --type SecureString` |
| `/blog/api/github-dispatch-token` | manual | fine-grained PAT, `Contents: write` + `Metadata: read` |

Rotating `jwt-secret` invalidates all existing JWTs and breaks the API key hash (HMAC pepper changed); rerun `rotate-api-key.mjs` and possibly `set-admin-password.mjs` after rotation.

### Routing
App Router under `src/app`. Dynamic segments: `posts/[slug]`, `categories/[category]`, `tags/[tag]`, `admin/{login,upload,posts}`. Static-route generators in `posts.ts` use the build-time cache; admin routes are pure client and emit a single static HTML each. Path alias `@/*` → `src/*` is configured in both `tsconfig.json` and `vitest.config.ts` — keep them in sync.

### Deployment
- **Static site** — GitHub Actions `.github/workflows/deploy.yml` runs on `push: main` *and* `repository_dispatch: types: [blog-rebuild]`. Sequence: checkout → AWS OIDC → S3 sync from `contentBucket` and `mediaBucket` into `content/posts/` and `public/media/` → `npm run build` → S3 sync `out/` → CloudFront invalidation. Required secrets: `AWS_ROLE_ARN`, `S3_BUCKET_NAME`, `CLOUDFRONT_DISTRIBUTION_ID`, `CONTENT_BUCKET_NAME`, `MEDIA_BUCKET_NAME`.
- **Infrastructure** — CDK `BlogStack` in `infra/`. Two S3 buckets for the static site (site + media, private with OAC), one for `contentBucket`, one CloudFront distribution with two behaviors (default → siteBucket, `/api/*` → API Gateway), one Lambda (`apiHandler`), one API Gateway REST API. CloudFront Function `UrlRewriteFunction` rewrites viewer requests to append `.html` to extensionless paths so clean URLs like `/posts/foo` resolve to `/posts/foo.html` in S3. If you add a new top-level route or asset extension, update the allowlist there.
- 404s are served by CloudFront's `errorResponses` mapping `404 → /404.html` with HTTP 200.

## Conventions worth knowing

- Strict TS at root (ES2017, `moduleResolution: "bundler"`); `api/` and `mcp-blog/` use `NodeNext` / ES2022. JS source files only in `scripts/` (which use `.mjs`).
- Tests colocate with code (`src/lib/*.test.ts`, `api/tests/*.test.ts`). Vitest env at root is `node`. Component tests would need their own jsdom config.
- All user-facing copy and admin UI labels are Japanese; the site `lang="ja"`.
- Tailwind v4 with typography plugin + custom `primary` palette; dark mode via `next-themes` (`darkMode: "selector"`). Global styles include `katex/dist/katex.min.css` from the root layout. Admin pages use the same Tailwind tokens.
- Path traversal protection: `getPost` calls `path.basename(slug)`; `api/src/schema.ts` Slug regex (`^[a-zA-Z0-9_-]+$`) does the same. Preserve both.
- The build cache in `posts.ts` is intentional — Next's static generation calls these helpers many times per build. Do not remove the module-scope cache.
- Admin pages MUST stay `"use client"` and avoid Server Components / Server Actions / `force-dynamic` so the static export survives.
- `api/` and `mcp-blog/` schemas are mirrors of each other (zod). When you change one, change the other.
