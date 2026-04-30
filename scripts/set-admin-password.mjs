/**
 * 管理者パスワードを設定するスクリプト
 * 使い方: node scripts/set-admin-password.mjs [--profile <profile>] [--region <region>]
 *
 * 対話的にパスワードを入力し、scrypt でハッシュ化後に
 * AWS Parameter Store (/blog/api/admin-password-hash) へ PUT します。
 * 平文パスワードはメモリ内のみで保持され、ファイルや履歴には残りません。
 */

import { createInterface } from "node:readline";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SSMClient, PutParameterCommand } from "@aws-sdk/client-ssm";

const scryptAsync = promisify(scrypt);

// --- CLI 引数パース ---
const args = process.argv.slice(2);
let profile = undefined;
let region = "ap-northeast-1";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--profile" && args[i + 1]) {
    profile = args[++i];
  } else if (args[i] === "--region" && args[i + 1]) {
    region = args[++i];
  }
}

// --- 対話プロンプト ---
function prompt(rl, question, silent = false) {
  return new Promise((resolve) => {
    if (silent && process.stdin.isTTY) {
      // TTY 環境では入力を非表示にする
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let input = "";
      const onData = (ch) => {
        ch = ch.toString();
        if (ch === "\n" || ch === "\r" || ch === "") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input);
        } else if (ch === "") {
          // バックスペース
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      };
      process.stdin.on("data", onData);
    } else {
      rl.question(question, resolve);
    }
  });
}

async function hashPassword(password) {
  const salt = randomBytes(32);
  // scrypt 推奨パラメータ: N=32768, r=8, p=1
  // 必要メモリ ≒ 64 MiB なので maxmem を 128 MiB に拡張 (デフォルト 32 MiB では不足)。
  const derived = await scryptAsync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  });
  // フォーマット: scrypt$<salt_hex>$<hash_hex>
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("=== 管理者パスワード設定 ===");
  if (profile) console.log(`AWS プロファイル: ${profile}`);
  console.log(`AWS リージョン: ${region}`);
  console.log(`Parameter Store キー: /blog/api/admin-password-hash`);
  console.log();

  let password;
  let confirm;

  try {
    password = await prompt(rl, "新しいパスワードを入力してください: ", true);
    if (!password || password.length < 12) {
      console.error("エラー: パスワードは 12 文字以上にしてください。");
      process.exit(1);
    }

    confirm = await prompt(rl, "パスワードを再入力してください: ", true);
    if (password !== confirm) {
      console.error("エラー: パスワードが一致しません。");
      process.exit(1);
    }
  } finally {
    rl.close();
  }

  console.log("\nパスワードをハッシュ化中...");
  const hash = await hashPassword(password);
  // メモリから平文を消去
  password = null;
  confirm = null;

  console.log("Parameter Store へ書き込み中...");

  const clientConfig = { region };
  if (profile) {
    const { fromIni } = await import("@aws-sdk/credential-providers");
    clientConfig.credentials = fromIni({ profile });
  }

  const ssm = new SSMClient(clientConfig);
  await ssm.send(
    new PutParameterCommand({
      Name: "/blog/api/admin-password-hash",
      Value: hash,
      Type: "SecureString",
      Overwrite: true,
      Description: "管理者パスワードの scrypt ハッシュ",
    })
  );

  console.log("完了: /blog/api/admin-password-hash を更新しました。");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
