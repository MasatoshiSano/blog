import { createHmac, timingSafeEqual } from "node:crypto";

// API キーは平文ではなく HMAC-SHA256 のハッシュを Parameter Store に保存する。
// 検証は受領した平文キーをサーバ側で同じ HMAC でハッシュし、登録済みハッシュ群と
// timing-safe 比較する。
//
// HMAC のキー (pepper) はサーバ固有の固定値。漏洩リスクを下げるため
// JWT secret とは別の SSM パラメータでも良いが、初版では JWT secret を流用する。

export function hashApiKey(plaintext: string, pepper: string): string {
  return createHmac("sha256", pepper).update(plaintext).digest("hex");
}

export function verifyApiKey(
  plaintext: string,
  hashes: string[],
  pepper: string
): boolean {
  if (!plaintext) return false;
  const candidate = hashApiKey(plaintext, pepper);
  const candidateBuf = Buffer.from(candidate, "hex");
  for (const h of hashes) {
    let knownBuf: Buffer;
    try {
      knownBuf = Buffer.from(h, "hex");
    } catch {
      continue;
    }
    if (knownBuf.length !== candidateBuf.length) continue;
    if (timingSafeEqual(knownBuf, candidateBuf)) return true;
  }
  return false;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
