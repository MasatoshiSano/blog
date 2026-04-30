# mcp-blog

MCP server for blog admin API. Provides tools to preview, publish, list, and delete blog posts from Claude Code via stdio transport.

## Tools

| Tool | Description |
|------|-------------|
| `blog_preview_post` | AI-assisted frontmatter completion and body structure correction. Returns corrected markdown + diff + Unsplash image suggestion. |
| `blog_publish_post` | Saves corrected markdown to S3 and triggers GitHub Actions rebuild. |
| `blog_list_posts` | Lists posts with optional `published` filter and `limit`. |
| `blog_delete_post` | Deletes a post by slug and triggers rebuild. |

## Setup

### Local path (development)

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "blog": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-blog/dist/index.js"],
      "env": {
        "BLOG_API_ENDPOINT": "https://dxbqlfvrescw1.cloudfront.net/api",
        "BLOG_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

### GitHub (future distribution)

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "blog": {
      "command": "npx",
      "args": ["-y", "github:sano/mcp-blog"],
      "env": {
        "BLOG_API_ENDPOINT": "https://dxbqlfvrescw1.cloudfront.net/api",
        "BLOG_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BLOG_API_ENDPOINT` | Yes | Base URL of the blog API (e.g. `https://dxbqlfvrescw1.cloudfront.net/api`) |
| `BLOG_API_KEY` | Yes | API key for HMAC authentication |

## Build

```bash
npm install
npm run build
```
