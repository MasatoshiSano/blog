import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { LoginRequestSchema } from "../schema.js";
import { parseJsonBody } from "../util/parse.js";
import { json, error } from "../util/response.js";
import { issueToken, buildSessionCookie } from "../auth/jwt.js";
import type { ApiSecrets } from "../ssm.js";

// promisify の標準型に options オーバーロードがないため、明示的にキャストする。
type ScryptFn = (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;
const scrypt = promisify(scryptCb) as unknown as ScryptFn;

// N=32768, r=8 の必要メモリ ≒ 64 MiB。デフォルトの maxmem (32 MiB) を超えるので明示。
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

// scripts/set-admin-password.mjs が書き込む形式: `scrypt$<salt_hex>$<hash_hex>`
// パラメータは N=32768, r=8, p=1, keylen=64 (Phase 0 と同一)。
async function verifyScryptPassword(
  stored: string,
  candidate: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const derived = await scrypt(candidate, salt, expected.length, SCRYPT_OPTS);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export async function handleLogin(
  event: APIGatewayProxyEvent,
  secrets: ApiSecrets
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody(event);
  const parsed = LoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return error(400, "invalid request", parsed.error.issues);
  }
  const ok = await verifyScryptPassword(
    secrets.adminPasswordHash,
    parsed.data.password
  );
  if (!ok) {
    return error(401, "invalid credentials");
  }
  const token = await issueToken("admin", secrets.jwtSecret);
  return json({ ok: true }, { cookies: [buildSessionCookie(token)] });
}
