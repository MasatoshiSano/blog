import { describe, it, expect } from "vitest";
import {
  hashApiKey,
  verifyApiKey,
  extractBearerToken,
} from "../src/auth/apiKey.js";

const PEPPER = "pepper-value-shared-with-jwt-secret";

describe("apiKey", () => {
  it("verifies a registered key", () => {
    const key = "abcd1234efgh5678";
    const h = hashApiKey(key, PEPPER);
    expect(verifyApiKey(key, [h], PEPPER)).toBe(true);
  });

  it("rejects an unknown key", () => {
    const known = hashApiKey("known-key", PEPPER);
    expect(verifyApiKey("other-key", [known], PEPPER)).toBe(false);
  });

  it("rejects empty input", () => {
    expect(verifyApiKey("", [hashApiKey("k", PEPPER)], PEPPER)).toBe(false);
  });

  it("supports multiple registered hashes (rotation)", () => {
    const old = hashApiKey("old-key", PEPPER);
    const fresh = hashApiKey("new-key", PEPPER);
    expect(verifyApiKey("new-key", [old, fresh], PEPPER)).toBe(true);
    expect(verifyApiKey("old-key", [old, fresh], PEPPER)).toBe(true);
    expect(verifyApiKey("nope", [old, fresh], PEPPER)).toBe(false);
  });

  it("extracts Bearer token", () => {
    expect(extractBearerToken("Bearer abc")).toBe("abc");
    expect(extractBearerToken("bearer abc-def")).toBe("abc-def");
    expect(extractBearerToken("Token abc")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("ignores hashes with bad hex", () => {
    expect(verifyApiKey("k", ["zzzz"], PEPPER)).toBe(false);
  });
});
