import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const COOKIE_NAME = "blog_admin_session";
const TTL_SECONDS = 24 * 60 * 60; // 24h

export interface SessionClaims {
  sub: string; // 管理者識別子 (現状は "admin" 固定)
  iat?: number;
  exp?: number;
}

function secretBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueToken(
  subject: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + TTL_SECONDS)
    .sign(secretBytes(secret));
}

export async function verifyToken(
  token: string,
  secret: string
): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secretBytes(secret), {
    algorithms: [ALG],
  });
  if (typeof payload.sub !== "string") {
    throw new Error("invalid sub");
  }
  return {
    sub: payload.sub,
    iat: payload.iat,
    exp: payload.exp,
  };
}

export function buildSessionCookie(token: string): string {
  // HttpOnly + Secure + SameSite=Strict。CloudFront 経由 (HTTPS) 前提。
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${TTL_SECONDS}`,
  ].join("; ");
}

export function buildLogoutCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}
