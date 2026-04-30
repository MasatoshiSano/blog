/**
 * API キーをローテーションするスクリプト
 * 使い方: node scripts/rotate-api-key.mjs [--profile <profile>] [--region <region>] [--append] [--force]
 *
 * - 32 バイト hex の平文キーを生成
 * - jwt-secret を pepper として HMAC-SHA256(plain) を計算
 * - HMAC ハッシュを /blog/api/api-key-hash に SecureString で保存
 *   (api/src/auth/apiKey.ts と同じ形式)
 * - 平文キーは標準出力に一度だけ表示。サーバ側には保存しない
 *
 * フラグ:
 *   --append  既存ハッシュをカンマ区切りで残し、新しいハッシュを末尾に追加
 *             (古いキーは依然として有効。`force-purge` するまで)
 *   --force   既存値があってもプロンプトをスキップして即上書き
 *
 * 前提: scripts/init-jwt-secret.mjs を先に実行して /blog/api/jwt-secret を設定済みであること。
 */

import { randomBytes, createHmac } from "node:crypto";
import { createInterface } from "node:readline";
import {
  SSMClient,
  PutParameterCommand,
  GetParameterCommand,
} from "@aws-sdk/client-ssm";

// --- CLI 引数パース ---
const args = process.argv.slice(2);
let profile = undefined;
let region = "ap-northeast-1";
let force = false;
let append = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--profile" && args[i + 1]) {
    profile = args[++i];
  } else if (args[i] === "--region" && args[i + 1]) {
    region = args[++i];
  } else if (args[i] === "--force" || args[i] === "-f") {
    force = true;
  } else if (args[i] === "--append") {
    append = true;
  }
}

const HASH_PARAM = "/blog/api/api-key-hash";
const PEPPER_PARAM = "/blog/api/jwt-secret";

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  console.log("=== API キーローテーション ===");
  if (profile) console.log(`AWS プロファイル: ${profile}`);
  console.log(`AWS リージョン: ${region}`);
  console.log(`Parameter Store: ${HASH_PARAM} (HMAC ハッシュ)`);
  console.log(`Pepper パラメータ: ${PEPPER_PARAM}`);
  console.log();

  const clientConfig = { region };
  if (profile) {
    const { fromIni } = await import("@aws-sdk/credential-providers");
    clientConfig.credentials = fromIni({ profile });
  }
  const ssm = new SSMClient(clientConfig);

  // jwt-secret (HMAC pepper) を取得
  let pepper;
  try {
    const res = await ssm.send(
      new GetParameterCommand({ Name: PEPPER_PARAM, WithDecryption: true })
    );
    pepper = res.Parameter?.Value;
    if (!pepper) throw new Error("empty");
  } catch (err) {
    if (err.name === "ParameterNotFound" || err.message === "empty") {
      console.error(
        `エラー: ${PEPPER_PARAM} が未設定です。先に scripts/init-jwt-secret.mjs を実行してください。`
      );
      process.exit(1);
    }
    throw err;
  }

  // 既存ハッシュ読み取り
  let existing = "";
  try {
    const res = await ssm.send(
      new GetParameterCommand({ Name: HASH_PARAM, WithDecryption: true })
    );
    existing = res.Parameter?.Value ?? "";
  } catch (err) {
    if (err.name !== "ParameterNotFound") throw err;
  }

  if (existing && !force && !append) {
    console.log(`既存の API キーハッシュが ${HASH_PARAM} に存在します。`);
    const answer = await confirm(
      "ローテーション (上書き) すると既存キーは無効になります。続行しますか? (yes/no): "
    );
    if (answer !== "yes" && answer !== "y") {
      console.log("キャンセルしました。");
      process.exit(0);
    }
  }

  // 平文キーを生成 → HMAC ハッシュを計算
  const plainKey = randomBytes(32).toString("hex");
  const hash = createHmac("sha256", pepper).update(plainKey).digest("hex");

  // append モード: 既存値にカンマ追加
  const valueToStore = append && existing ? `${existing},${hash}` : hash;

  await ssm.send(
    new PutParameterCommand({
      Name: HASH_PARAM,
      Value: valueToStore,
      Type: "SecureString",
      Overwrite: true,
      Description: "ブログ API のキーハッシュ (HMAC-SHA256, pepper=jwt-secret)",
    })
  );

  console.log(`完了: ${HASH_PARAM} を更新しました (${append ? "append" : "replace"})。`);
  console.log();
  console.log("新しい API キー (この画面にのみ表示されます):");
  console.log(`  ${plainKey}`);
  console.log();
  console.log("MCP クライアントの BLOG_API_KEY 環境変数または ~/.claude/settings.json を更新してください。");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
