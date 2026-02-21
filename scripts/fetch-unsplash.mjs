/**
 * Unsplash画像事前取得スクリプト
 * 使い方: npm run fetch-unsplash
 *
 * .env.local に UNSPLASH_ACCESS_KEY を設定してから実行してください。
 * 取得した画像URLは src/data/unsplash-images.json に保存されます。
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// .env.local を読み込む
try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^([^#][^=]*)=(.*)/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env.local がなければ process.env をそのまま使用
}

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!ACCESS_KEY) {
  console.error("Error: UNSPLASH_ACCESS_KEY が設定されていません。");
  console.error(".env.local に UNSPLASH_ACCESS_KEY=<your_access_key> を追記してください。");
  process.exit(1);
}

const APP_NAME = "blog";
const QUERY = "technology programming";
const COUNT = 30;

console.log(`Unsplash から ${COUNT} 枚の画像を取得中...`);

const response = await fetch(
  `https://api.unsplash.com/photos/random?count=${COUNT}&query=${encodeURIComponent(QUERY)}&orientation=landscape`,
  {
    headers: {
      Authorization: `Client-ID ${ACCESS_KEY}`,
    },
  }
);

if (!response.ok) {
  const text = await response.text();
  console.error(`Unsplash API エラー: ${response.status} ${response.statusText}`);
  console.error(text);
  process.exit(1);
}

const photos = await response.json();

const images = photos.map((photo) => ({
  url: photo.urls.regular,
  photographer: photo.user.name,
  photographerUrl: `${photo.user.links.html}?utm_source=${APP_NAME}&utm_medium=referral`,
  unsplashUrl: `${photo.links.html}?utm_source=${APP_NAME}&utm_medium=referral`,
}));

const outPath = join(ROOT, "src", "data", "unsplash-images.json");
mkdirSync(join(ROOT, "src", "data"), { recursive: true });
writeFileSync(outPath, JSON.stringify(images, null, 2) + "\n");

console.log(`✓ ${images.length} 枚の画像を src/data/unsplash-images.json に保存しました`);
