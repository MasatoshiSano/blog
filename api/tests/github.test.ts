import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { triggerDispatch, __setFetchForTest } from "../src/github.js";

describe("github.triggerDispatch", () => {
  beforeEach(() => {
    __setFetchForTest(null);
  });
  afterEach(() => {
    __setFetchForTest(null);
  });

  it("posts to /dispatches with proper headers and body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 204 })
    );
    __setFetchForTest(fetchMock as unknown as typeof fetch);
    await triggerDispatch({
      repo: "owner/blog",
      token: "ghp_xxx",
      eventType: "blog-rebuild",
      clientPayload: { slug: "abc" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = call[0];
    const init = call[1];
    expect(url).toBe("https://api.github.com/repos/owner/blog/dispatches");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_xxx");
    expect(headers.Accept).toBe("application/vnd.github+json");
    const body = JSON.parse(init.body as string);
    expect(body.event_type).toBe("blog-rebuild");
    expect(body.client_payload).toEqual({ slug: "abc" });
  });

  it("throws on non-2xx response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("nope", { status: 401, statusText: "Unauthorized" })
    );
    __setFetchForTest(fetchMock as unknown as typeof fetch);
    await expect(
      triggerDispatch({
        repo: "owner/blog",
        token: "bad",
        eventType: "blog-rebuild",
      })
    ).rejects.toThrow(/401/);
  });
});
