import { describe, it, expect } from "vitest";
import {
  issueToken,
  verifyToken,
  buildSessionCookie,
  buildLogoutCookie,
  getSessionCookieName,
} from "../src/auth/jwt.js";

const SECRET = "test-secret-must-be-long-enough-for-hs256";

describe("jwt", () => {
  it("issues and verifies a token round-trip", async () => {
    const token = await issueToken("admin", SECRET);
    expect(typeof token).toBe("string");
    const claims = await verifyToken(token, SECRET);
    expect(claims.sub).toBe("admin");
    expect(typeof claims.exp).toBe("number");
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await issueToken("admin", SECRET);
    await expect(verifyToken(token, "other-secret-other-other")).rejects.toThrow();
  });

  it("rejects malformed tokens", async () => {
    await expect(verifyToken("not.a.jwt", SECRET)).rejects.toThrow();
  });

  it("builds session cookie with HttpOnly, Secure, SameSite=Strict", () => {
    const cookie = buildSessionCookie("xyz");
    expect(cookie).toContain(`${getSessionCookieName()}=xyz`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=86400");
  });

  it("builds a logout cookie with Max-Age=0", () => {
    const cookie = buildLogoutCookie();
    expect(cookie).toContain("Max-Age=0");
  });
});
