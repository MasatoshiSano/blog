import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { authenticate } from "../src/auth/middleware.js";
import { issueToken, getSessionCookieName } from "../src/auth/jwt.js";
import { hashApiKey } from "../src/auth/apiKey.js";
import type { ApiSecrets } from "../src/ssm.js";

const JWT_SECRET = "secret-which-is-long-enough-for-hs256-tests";
const VALID_API_KEY = "valid-api-key-1";

function makeSecrets(): ApiSecrets {
  return {
    adminPasswordHash: "n/a",
    jwtSecret: JWT_SECRET,
    apiKeyHashes: [hashApiKey(VALID_API_KEY, JWT_SECRET)],
    anthropicKey: "sk-test",
    githubDispatchToken: "gh-test",
  };
}

function evt(headers: Record<string, string>): APIGatewayProxyEvent {
  return { headers } as unknown as APIGatewayProxyEvent;
}

describe("authenticate middleware", () => {
  it("returns null with no credentials", async () => {
    const result = await authenticate(evt({}), makeSecrets());
    expect(result).toBeNull();
  });

  it("accepts a valid JWT cookie", async () => {
    const token = await issueToken("admin", JWT_SECRET);
    const result = await authenticate(
      evt({ Cookie: `${getSessionCookieName()}=${token}` }),
      makeSecrets()
    );
    expect(result).not.toBeNull();
    expect(result?.method).toBe("jwt");
    expect(result?.subject).toBe("admin");
  });

  it("rejects an expired/invalid JWT cookie and falls through", async () => {
    const result = await authenticate(
      evt({ Cookie: `${getSessionCookieName()}=garbage.jwt.value` }),
      makeSecrets()
    );
    expect(result).toBeNull();
  });

  it("accepts a valid API key", async () => {
    const result = await authenticate(
      evt({ Authorization: `Bearer ${VALID_API_KEY}` }),
      makeSecrets()
    );
    expect(result?.method).toBe("apiKey");
    expect(result?.subject).toBe("api-client");
  });

  it("rejects a wrong API key", async () => {
    const result = await authenticate(
      evt({ Authorization: "Bearer wrong-key" }),
      makeSecrets()
    );
    expect(result).toBeNull();
  });

  it("falls through from invalid JWT to valid API key", async () => {
    const result = await authenticate(
      evt({
        Cookie: `${getSessionCookieName()}=garbage`,
        Authorization: `Bearer ${VALID_API_KEY}`,
      }),
      makeSecrets()
    );
    expect(result?.method).toBe("apiKey");
  });
});
