/**
 * cover image optimizer
 *
 * 使い方: node scripts/optimize-cover-images.mjs
 *
 * public/images/posts/ 以下の .jpg/.jpeg/.png を sharp で
 *   width: max 1200px, format: WebP, quality: 75
 * に再エンコードして同じファイル名 (拡張子は .webp) で出力する。
 * 元ファイルは削除し、content/posts/*.md の frontmatter も .webp に置換。
 *
 * 単発実行 (大半は元から WebP) なので idempotent。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const IMAGES_DIR = path.join(ROOT, "public", "images", "posts");
const POSTS_DIR = path.join(ROOT, "content", "posts");
const MAX_WIDTH = 1200;
const QUALITY = 75;

async function processImage(filename) {
  const inputPath = path.join(IMAGES_DIR, filename);
  const ext = path.extname(filename).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(ext)) {
    return { filename, skipped: true, reason: `extension ${ext}` };
  }
  const outputName = filename.replace(/\.(jpg|jpeg|png)$/i, ".webp");
  const outputPath = path.join(IMAGES_DIR, outputName);

  const input = await fs.readFile(inputPath);
  const sizeBefore = input.length;
  const output = await sharp(input)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  await fs.writeFile(outputPath, output);
  if (outputName !== filename) {
    await fs.unlink(inputPath);
  }

  return {
    filename,
    outputName,
    sizeBefore,
    sizeAfter: output.length,
    saved: ((sizeBefore - output.length) / sizeBefore * 100).toFixed(1),
  };
}

async function rewriteFrontmatter() {
  const files = await fs.readdir(POSTS_DIR);
  const md = files.filter((f) => f.endsWith(".md"));
  let touched = 0;
  for (const f of md) {
    const p = path.join(POSTS_DIR, f);
    const original = await fs.readFile(p, "utf-8");
    const updated = original.replace(
      /^(coverImage:\s*"[^"]+)\.(jpg|jpeg|png)(")/im,
      "$1.webp$3"
    );
    if (updated !== original) {
      await fs.writeFile(p, updated, "utf-8");
      touched++;
    }
  }
  return touched;
}

async function main() {
  const files = await fs.readdir(IMAGES_DIR);
  console.log(`対象: ${files.length} 件`);
  const results = [];
  for (const f of files) {
    try {
      results.push(await processImage(f));
    } catch (err) {
      console.error(`fail: ${f}`, err.message);
    }
  }

  let totalBefore = 0;
  let totalAfter = 0;
  for (const r of results) {
    if (r.skipped) {
      console.log(`[skip] ${r.filename} (${r.reason})`);
    } else {
      totalBefore += r.sizeBefore;
      totalAfter += r.sizeAfter;
      const arrow = r.outputName === r.filename ? "(in-place)" : `→ ${r.outputName}`;
      console.log(
        `[ok]   ${r.filename} ${arrow}  ${(r.sizeBefore / 1024).toFixed(0)} KB → ${(r.sizeAfter / 1024).toFixed(0)} KB (-${r.saved}%)`
      );
    }
  }

  console.log("─".repeat(60));
  console.log(
    `合計: ${(totalBefore / 1024 / 1024).toFixed(1)} MB → ${(totalAfter / 1024 / 1024).toFixed(1)} MB (-${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}%)`
  );

  const touched = await rewriteFrontmatter();
  console.log(`frontmatter 書き換え: ${touched} 件`);
}

await main();
