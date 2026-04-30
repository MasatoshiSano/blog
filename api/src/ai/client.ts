import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { LUCIDE_ICON_CANDIDATES, SYSTEM_PROMPT } from "./prompts.js";

// Bedrock の Claude Haiku 4.5 モデル ID。デフォルトは JP cross-region inference
// profile (Tokyo + Osaka を跨いで routing、データは Japan 域内のみ)。
// 環境変数 BEDROCK_MODEL_ID で override 可能。
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ??
  "jp.anthropic.claude-haiku-4-5-20251001-v1:0";

export interface AiPreviewResult {
  frontmatter: {
    title: string;
    icon: string;
    type: "tech" | "idea";
    topics: string[];
    category: string;
    date: string;
    published: boolean;
    description: string;
    iconCandidates: string[];
  };
  correctedMarkdown: string;
  diff: string[];
}

let _factory: () => AnthropicBedrock = () => new AnthropicBedrock();

export function __setAnthropicFactoryForTest(
  factory: (() => AnthropicBedrock) | null
): void {
  _factory = factory ?? (() => new AnthropicBedrock());
}

function clampIcon(icon: string): string {
  return LUCIDE_ICON_CANDIDATES.includes(icon) ? icon : "file-text";
}

function extractJson(text: string): unknown {
  // モデルが ```json ``` で囲んできたケースに備えて剥がす。
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const raw = fenceMatch ? fenceMatch[1] : text;
  return JSON.parse(raw);
}

export async function correctPostWithAi(
  markdown: string
): Promise<AiPreviewResult> {
  const client = _factory();
  const res = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `次の Markdown を補正してください。frontmatter (---) があれば既存値として尊重してください。\n\n${markdown}`,
      },
    ],
  });

  const textBlock = res.content.find(
    (c): c is Extract<typeof c, { type: "text" }> => c.type === "text"
  );
  if (!textBlock) {
    throw new Error("AI returned no text content");
  }
  const parsed = extractJson(textBlock.text) as AiPreviewResult;
  parsed.frontmatter.icon = clampIcon(parsed.frontmatter.icon);
  parsed.frontmatter.iconCandidates = (parsed.frontmatter.iconCandidates ?? [])
    .map(clampIcon)
    .slice(0, 4);
  return parsed;
}
