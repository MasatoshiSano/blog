import type { APIGatewayProxyEvent } from "aws-lambda";
import { extractBearerToken, verifyApiKey } from "./apiKey.js";
import { verifyToken, getSessionCookieName, type SessionClaims } from "./jwt.js";
import { parseCookies, getHeader } from "../util/parse.js";
import type { ApiSecrets } from "../ssm.js";

export interface AuthContext {
  method: "jwt" | "apiKey";
  subject: string;
}

// JWT (Cookie) または API キー (Authorization: Bearer ...) のどちらかが通ればOK。
export async function authenticate(
  event: APIGatewayProxyEvent,
  secrets: ApiSecrets
): Promise<AuthContext | null> {
  // 1) Cookie の JWT
  const cookies = parseCookies(event);
  const jwtCookie = cookies[getSessionCookieName()];
  if (jwtCookie) {
    try {
      const claims: SessionClaims = await verifyToken(jwtCookie, secrets.jwtSecret);
      return { method: "jwt", subject: claims.sub };
    } catch {
      // 通過しなければ API キー判定にフォールスルー
    }
  }

  // 2) Authorization: Bearer <api-key>
  const authHeader = getHeader(event, "authorization");
  const bearer = extractBearerToken(authHeader);
  if (bearer) {
    if (verifyApiKey(bearer, secrets.apiKeyHashes, secrets.jwtSecret)) {
      return { method: "apiKey", subject: "api-client" };
    }
  }

  return null;
}
