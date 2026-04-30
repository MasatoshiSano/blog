import type { APIGatewayProxyEvent } from "aws-lambda";

export function parseJsonBody<T = unknown>(event: APIGatewayProxyEvent): T | null {
  if (!event.body) return null;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function parseCookies(event: APIGatewayProxyEvent): Record<string, string> {
  const cookieHeader =
    event.headers?.Cookie ?? event.headers?.cookie ?? "";
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function getHeader(
  event: APIGatewayProxyEvent,
  name: string
): string | undefined {
  if (!event.headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (key.toLowerCase() === lower && value !== undefined) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}
