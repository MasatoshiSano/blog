import type { APIGatewayProxyResult } from "aws-lambda";

export interface JsonResponseInit {
  statusCode?: number;
  headers?: Record<string, string>;
  cookies?: string[];
}

export function json(body: unknown, init: JsonResponseInit = {}): APIGatewayProxyResult {
  const { statusCode = 200, headers = {}, cookies } = init;
  const result: APIGatewayProxyResult = {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
  if (cookies && cookies.length > 0) {
    // API Gateway REST API: Set-Cookie は multiValueHeaders で渡す。
    (result as APIGatewayProxyResult & { multiValueHeaders?: Record<string, string[]> }).multiValueHeaders = {
      "Set-Cookie": cookies,
    };
  }
  return result;
}

export function error(
  statusCode: number,
  message: string,
  details?: unknown
): APIGatewayProxyResult {
  return json({ error: message, ...(details !== undefined ? { details } : {}) }, { statusCode });
}
