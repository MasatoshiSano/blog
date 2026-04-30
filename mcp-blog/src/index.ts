#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  toolDefinitions,
  handlePreviewPost,
  handlePublishPost,
  handleListPosts,
  handleDeletePost,
} from "./tools.js";

const server = new Server(
  { name: "mcp-blog", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ツール一覧を返す
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

// ツール呼び出しを処理する
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let text: string;
    switch (name) {
      case "blog_preview_post":
        text = await handlePreviewPost(args);
        break;
      case "blog_publish_post":
        text = await handlePublishPost(args);
        break;
      case "blog_list_posts":
        text = await handleListPosts(args);
        break;
      case "blog_delete_post":
        text = await handleDeletePost(args);
        break;
      default:
        return {
          content: [{ type: "text", text: `未知のツール: ${name}` }],
          isError: true,
        };
    }

    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `エラー: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr に出力 (stdout は MCP プロトコル専用)
  process.stderr.write("mcp-blog server started (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
