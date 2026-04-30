# blog-api

Lambda handlers for blog admin API: auth (JWT + API key), AI-assisted post preview, publish to S3, GitHub `repository_dispatch` trigger, image presign.

## Layout

```
api/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── data/
│   └── unsplash-images.json   # snapshot of src/data/unsplash-images.json
├── src/
│   ├── index.ts               # API Gateway proxy entry (router)
│   ├── ssm.ts                 # SSM Parameter Store loader (cold-start cache)
│   ├── s3.ts                  # S3 put/get/delete/list/presign
│   ├── github.ts              # repository_dispatch trigger
│   ├── unsplash.ts            # djb2 hash -> deterministic image
│   ├── schema.ts              # zod request schemas
│   ├── types.ts               # PostFrontmatter mirror of src/types/post.ts
│   ├── auth/
│   │   ├── jwt.ts             # HS256 (jose), HttpOnly cookie helpers
│   │   ├── apiKey.ts          # HMAC-SHA256, timing-safe verify, multi-hash rotation
│   │   └── middleware.ts      # JWT cookie OR API key bearer
│   ├── routes/
│   │   ├── login.ts           # scrypt verify (matches scripts/set-admin-password.mjs format) -> session cookie
│   │   ├── posts.ts           # preview / publish / list / delete
│   │   └── images.ts          # pre-signed PUT URL (5 min)
│   ├── ai/
│   │   ├── client.ts          # Anthropic SDK + ephemeral prompt caching
│   │   └── prompts.ts         # frontmatter+icon system prompt
│   └── util/
│       ├── parse.ts           # body / cookie / header parsing
│       └── response.ts        # JSON / error / Set-Cookie helpers
└── tests/                     # vitest, mocked AWS / Anthropic / fetch
```

## Scripts

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # esbuild -> dist/index.js (CJS, node20)
```

## SSM Parameter Store layout

Lambda reads on cold start (path prefix from `PARAMETER_STORE_PREFIX`, default `/blog/api`):

| Parameter | Type | Notes |
|---|---|---|
| `/blog/api/admin-password-hash` | SecureString | `scrypt$<salt_hex>$<hash_hex>` (N=32768, r=8, p=1, keylen=64). Set via `scripts/set-admin-password.mjs`. |
| `/blog/api/jwt-secret` | SecureString | HS256 signing key; also used as HMAC pepper for API key hashes. Set via `scripts/init-jwt-secret.mjs`. |
| `/blog/api/api-key-hash` | SecureString | Comma-separated HMAC-SHA256 hashes (rotation-friendly). Produced by `scripts/rotate-api-key.mjs` (use `--append` to keep older keys valid). |
| `/blog/api/anthropic-key` | SecureString | Anthropic API key (Claude Haiku 4.5). Manual provisioning. |
| `/blog/api/github-dispatch-token` | SecureString | GitHub PAT with `repository_dispatch` permission. Manual provisioning. |

## Initial provisioning order

1. `node scripts/init-jwt-secret.mjs` — creates `/blog/api/jwt-secret`.
2. `node scripts/set-admin-password.mjs` — sets the admin password (scrypt-hashed).
3. `node scripts/rotate-api-key.mjs` — creates the first API key (depends on jwt-secret existing).
4. Manually `aws ssm put-parameter --name /blog/api/anthropic-key --type SecureString --value '...' --overwrite`.
5. Manually `aws ssm put-parameter --name /blog/api/github-dispatch-token --type SecureString --value 'ghp_...' --overwrite`.

Rotating jwt-secret invalidates ALL existing JWTs and breaks API key hashes; rerun step 3 (and possibly step 2) after rotation.

## Required env vars (set by CDK)

| Var | Purpose |
|---|---|
| `CONTENT_BUCKET` | S3 bucket for `posts/<slug>.md` |
| `MEDIA_BUCKET` | S3 bucket for image uploads (presign target) |
| `PARAMETER_STORE_PREFIX` | SSM prefix (default `/blog/api`) |
| `GITHUB_DISPATCH_REPO` | `owner/repo`, target of `repository_dispatch` |

## Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/login` | none | scrypt verify + issue JWT cookie |
| POST | `/admin/posts/preview` | JWT \| API key | run AI corrector + Unsplash suggestion |
| POST | `/admin/posts/publish` | JWT \| API key | strict zod validate, write S3, fire dispatch |
| GET | `/admin/posts` | JWT \| API key | list posts from contentBucket |
| DELETE | `/admin/posts/{slug}` | JWT \| API key | delete + dispatch rebuild |
| POST | `/admin/images/upload-url` | JWT \| API key | 5-min PUT presign on mediaBucket |

CloudFront prepends `/api`, the handler strips that prefix automatically.

## Manual follow-ups

- **GitHub PAT provisioning**: Create a fine-grained PAT for the repo with permission `Contents: write` and `Metadata: read`. Store it via:
  ```bash
  aws ssm put-parameter \
    --name /blog/api/github-dispatch-token \
    --type SecureString \
    --value 'ghp_xxx' \
    --overwrite
  ```
- **CDK Lambda swap**: After `npm run build`, lead updates `infra/lib/blog-stack.ts` from `Code.fromInline(...)` to `Code.fromAsset("../api/dist")` and changes the handler reference accordingly. Then `cd infra && npm run build && cdk deploy`.
