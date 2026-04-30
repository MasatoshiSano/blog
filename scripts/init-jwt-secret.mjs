/**
 * JWT 署名鍵 (HS256) を初期化するスクリプト
 * 使い方: node scripts/init-jwt-secret.mjs [--profile <profile>] [--region <region>] [--force]
 *
 * - 64 バイト hex のランダムシークレットを生成
 * - /blog/api/jwt-secret に SecureString で保存
 * - 既に存在する場合は確認プロンプト (--force でスキップ)
 *
 * 注意: この鍵をローテーションすると既発行の JWT (Web セッション Cookie) は全て無効になり、
 * 既存の API キーハッシュ (HMAC pepper として使用) も再計算が必要になる
 * (scripts/rotate-api-key.mjs を再実行する)。
 */

import { randomBytes } from "node:crypto";
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

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--profile" && args[i + 1]) {
    profile = args[++i];
  } else if (args[i] === "--region" && args[i + 1]) {
    region = args[++i];
  } else if (args[i] === "--force" || args[i] === "-f") {
    force = true;
  }
}

const PARAM_NAME = "/blog/api/jwt-secret";

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
  console.log("=== JWT 署名鍵の初期化 ===");
  if (profile) console.log(`AWS プロファイル: ${profile}`);
  console.log(`AWS リージョン: ${region}`);
  console.log(`Parameter Store: ${PARAM_NAME}`);
  console.log();

  const clientConfig = { region };
  if (profile) {
    const { fromIni } = await import("@aws-sdk/credential-providers");
    clientConfig.credentials = fromIni({ profile });
  }
  const ssm = new SSMClient(clientConfig);

  // 既存値確認
  let existsAlready = false;
  try {
    await ssm.send(
      new GetParameterCommand({ Name: PARAM_NAME, WithDecryption: false })
    );
    existsAlready = true;
  } catch (err) {
    if (err.name !== "ParameterNotFound") throw err;
  }

  if (existsAlready && !force) {
    console.log(`既存の JWT secret が ${PARAM_NAME} に存在します。`);
    console.log(
      "上書きすると、現在発行済みの Web セッションは全て無効になり、API キーハッシュも再生成が必要になります。"
    );
    const answer = await confirm("続行しますか? (yes/no): ");
    if (answer !== "yes" && answer !== "y") {
      console.log("キャンセルしました。");
      process.exit(0);
    }
  }

  const secret = randomBytes(64).toString("hex");
  await ssm.send(
    new PutParameterCommand({
      Name: PARAM_NAME,
      Value: secret,
      Type: "SecureString",
      Overwrite: true,
      Description: "JWT 署名鍵 (HS256) と API キー HMAC の pepper",
    })
  );

  console.log(`完了: ${PARAM_NAME} を更新しました。`);
  if (existsAlready) {
    console.log(
      "次にやること: scripts/rotate-api-key.mjs を実行して API キーハッシュを再計算してください。"
    );
  }
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
