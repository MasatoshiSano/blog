#!/usr/bin/env node
/**
 * emoji → icon マイグレーションスクリプト
 *
 * 使い方:
 *   node scripts/migrate-emoji-to-icon.mjs            # ドライラン (変更なし、プレビュー表示)
 *   node scripts/migrate-emoji-to-icon.mjs --apply    # 実際にファイルを書き換え
 *
 * --apply フラグを明示しない限りファイルは一切変更されない。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.resolve(__dirname, "../content/posts");
const APPLY = process.argv.includes("--apply");

// emoji → Lucide アイコン名の対応テーブル (ドライラン用・AI なしで動作)
const EMOJI_TO_ICON = {
  "🔐": "lock",
  "🔒": "lock",
  "🔑": "key",
  "🖥️": "monitor",
  "💻": "laptop",
  "📝": "file-text",
  "📄": "file-text",
  "🗒️": "file-text",
  "📦": "package",
  "🚀": "rocket",
  "⚡": "zap",
  "🌐": "globe",
  "🔧": "wrench",
  "🛠️": "wrench",
  "⚙️": "settings",
  "🎨": "palette",
  "🎯": "target",
  "📊": "bar-chart-2",
  "📈": "trending-up",
  "📉": "trending-down",
  "🔍": "search",
  "🔎": "search",
  "💡": "lightbulb",
  "🧪": "test-tube",
  "🧩": "puzzle",
  "🗄️": "database",
  "🏗️": "building-2",
  "🏛️": "landmark",
  "🗂️": "folder",
  "📁": "folder",
  "📂": "folder-open",
  "🌟": "star",
  "⭐": "star",
  "❤️": "heart",
  "✅": "check-circle",
  "❌": "x-circle",
  "⚠️": "alert-triangle",
  "ℹ️": "info",
  "🔔": "bell",
  "📣": "megaphone",
  "💬": "message-circle",
  "💭": "message-circle",
  "🔗": "link",
  "📎": "paperclip",
  "🖊️": "pen",
  "✏️": "pencil",
  "🗑️": "trash-2",
  "🔄": "refresh-cw",
  "⏱️": "timer",
  "🕐": "clock",
  "📅": "calendar",
  "🗓️": "calendar",
  "👤": "user",
  "👥": "users",
  "🤖": "bot",
  "🧠": "brain",
  "☁️": "cloud",
  "🌩️": "cloud-lightning",
  "🛡️": "shield",
  "🔓": "unlock",
  "📡": "wifi",
  "📱": "smartphone",
  "🖱️": "mouse-pointer",
  "⌨️": "keyboard",
  "🖨️": "printer",
  "📷": "camera",
  "🎥": "video",
  "🎵": "music",
  "📚": "book-open",
  "📖": "book-open",
  "📰": "newspaper",
  "🏷️": "tag",
  "🔖": "bookmark",
  "💾": "save",
  "💿": "disc",
  "🖲️": "mouse",
  "🔌": "plug",
  "💡": "lightbulb",
  "🔦": "flashlight",
  "🌈": "sparkles",
  "✨": "sparkles",
  "🎉": "party-popper",
  "🎊": "party-popper",
  "🚧": "construction",
  "🔩": "nut",
  "⛓️": "link-2",
  "🧲": "magnet",
  "🔬": "microscope",
  "🧬": "dna",
  "🌱": "sprout",
  "🌿": "leaf",
};

/**
 * YAML frontmatter の特定フィールド値を読み取る
 * (gray-matter を使わず正規表現で処理することで依存なし)
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return match[1];
}

function getFrontmatterField(yaml, field) {
  const re = new RegExp(`^${field}:\\s*["']?([^"'\\r\\n]+?)["']?\\s*$`, "m");
  const m = yaml.match(re);
  return m ? m[1].trim() : null;
}

function hasFrontmatterField(yaml, field) {
  return new RegExp(`^${field}:`, "m").test(yaml);
}

/**
 * emoji フィールドを icon フィールドに置換した新しい frontmatter を返す
 */
function buildNewFrontmatter(yaml, iconName) {
  // emoji 行を icon 行に置換
  const replaced = yaml.replace(/^emoji:.*$/m, `icon: "${iconName}"`);
  return replaced;
}

function buildNewContent(content, newYaml) {
  return content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, `---\n${newYaml}\n---`);
}

// メイン処理
const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));

if (files.length === 0) {
  console.log("記事ファイルが見つかりません:", POSTS_DIR);
  process.exit(0);
}

console.log(`対象ファイル数: ${files.length}`);
console.log(`モード: ${APPLY ? "書き換え (--apply)" : "ドライラン (変更なし)"}`);
console.log("─".repeat(60));

let skipped = 0;
let migrated = 0;
let noMapping = 0;

for (const file of files) {
  const filePath = path.join(POSTS_DIR, file);
  const content = fs.readFileSync(filePath, "utf-8");
  const yaml = parseFrontmatter(content);

  if (!yaml) {
    console.log(`[スキップ] ${file}: frontmatter が見つかりません`);
    skipped++;
    continue;
  }

  // すでに icon フィールドがあればスキップ
  if (hasFrontmatterField(yaml, "icon")) {
    console.log(`[スキップ] ${file}: icon フィールドがすでに存在します`);
    skipped++;
    continue;
  }

  const emoji = getFrontmatterField(yaml, "emoji");
  if (!emoji) {
    console.log(`[スキップ] ${file}: emoji フィールドがありません`);
    skipped++;
    continue;
  }

  const iconName = EMOJI_TO_ICON[emoji];
  if (!iconName) {
    console.log(`[未対応] ${file}: emoji "${emoji}" の対応アイコンが未定義 → file-text を使用`);
    noMapping++;
    const newYaml = buildNewFrontmatter(yaml, "file-text");
    if (APPLY) {
      fs.writeFileSync(filePath, buildNewContent(content, newYaml), "utf-8");
    }
    migrated++;
    continue;
  }

  console.log(`[移行] ${file}: emoji "${emoji}" → icon "${iconName}"`);
  if (APPLY) {
    const newYaml = buildNewFrontmatter(yaml, iconName);
    fs.writeFileSync(filePath, buildNewContent(content, newYaml), "utf-8");
  }
  migrated++;
}

console.log("─".repeat(60));
console.log(`移行対象: ${migrated} ファイル (うち対応表なし: ${noMapping})`);
console.log(`スキップ: ${skipped} ファイル`);
if (!APPLY) {
  console.log("\n実際に書き換えるには --apply フラグを付けて実行してください。");
}
