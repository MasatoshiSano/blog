import { describe, it, expect } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { parseJsonBody, parseCookies, getHeader } from "../src/util/parse.js";

function evt(partial: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return partial as APIGatewayProxyEvent;
}

describe("parse", () => {
  it("parseJsonBody returns null for missing body", () => {
    expect(parseJsonBody(evt({}))).toBeNull();
  });
  it("parseJsonBody parses utf-8 JSON body", () => {
    const result = parseJsonBody<{ a: number }>(
      evt({ body: '{"a":1}', isBase64Encoded: false })
    );
    expect(result).toEqual({ a: 1 });
  });
  it("parseJsonBody parses base64 body", () => {
    const result = parseJsonBody<{ a: number }>(
      evt({
        body: Buffer.from('{"a":2}', "utf-8").toString("base64"),
        isBase64Encoded: true,
      })
    );
    expect(result).toEqual({ a: 2 });
  });
  it("parseJsonBody returns null on invalid JSON", () => {
    expect(parseJsonBody(evt({ body: "not json" }))).toBeNull();
  });

  it("parseCookies parses standard Cookie header", () => {
    const cookies = parseCookies(
      evt({ headers: { Cookie: "a=1; b=two; c=three" } })
    );
    expect(cookies).toEqual({ a: "1", b: "two", c: "three" });
  });
  it("parseCookies handles lowercase cookie header", () => {
    const cookies = parseCookies(evt({ headers: { cookie: "a=1" } }));
    expect(cookies).toEqual({ a: "1" });
  });
  it("parseCookies returns empty object when missing", () => {
    expect(parseCookies(evt({ headers: {} }))).toEqual({});
  });

  it("getHeader matches case-insensitively", () => {
    const event = evt({ headers: { "X-Custom": "abc" } });
    expect(getHeader(event, "x-custom")).toBe("abc");
    expect(getHeader(event, "X-CUSTOM")).toBe("abc");
    expect(getHeader(event, "missing")).toBeUndefined();
  });
});
