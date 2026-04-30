import { describe, it, expect } from "vitest";
import { getUnsplashImageForSlug } from "../src/unsplash.js";

describe("unsplash", () => {
  it("returns a deterministic image for the same slug", () => {
    const a = getUnsplashImageForSlug("hello-world");
    const b = getUnsplashImageForSlug("hello-world");
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a?.url).toMatch(/^https:\/\/images\.unsplash\.com\//);
  });

  it("returns different images for sufficiently different slugs", () => {
    const a = getUnsplashImageForSlug("aaa");
    const b = getUnsplashImageForSlug("zzz-completely-different-slug");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Not strictly required to differ but with a 30-image pool and djb2,
    // these two slugs hash to different buckets.
    expect(a?.url).not.toBe(b?.url);
  });

  it("handles empty-string slug", () => {
    const img = getUnsplashImageForSlug("");
    expect(img).not.toBeNull();
  });
});
