import { beforeEach, describe, expect, it } from "vitest";

import {
  FETCH_CACHE_TTL_MS,
  cachedFetch,
  clearFetchCache,
  rememberFetch,
} from "./fetchCache.js";

describe("the fetch cache", () => {
  beforeEach(() => {
    clearFetchCache();
  });

  it("serves a page it saw a moment ago", () => {
    rememberFetch("https://example.com", "body", 1_000);

    expect(cachedFetch("https://example.com", 1_500)).toBe("body");
  });

  it("forgets a page once its window has passed", () => {
    rememberFetch("https://example.com", "body", 1_000);

    // The boundary is what the tool's own copy promises: ten minutes.
    expect(cachedFetch("https://example.com", 1_000 + FETCH_CACHE_TTL_MS)).toBe(
      undefined,
    );
  });

  it("keeps the cache bounded, dropping the least recently used page", () => {
    rememberFetch("https://example.com/keep", "keep", 1_000);
    for (let i = 0; i < 49; i += 1) {
      rememberFetch(`https://example.com/${i}`, `body ${i}`, 1_000);
    }
    // Full at 50, with "keep" the oldest. Reading it makes it the newest, so the
    // entry the next insert costs is the one nobody has read since.
    expect(cachedFetch("https://example.com/keep", 1_001)).toBe("keep");

    rememberFetch("https://example.com/new", "new", 1_001);

    expect(cachedFetch("https://example.com/new", 1_002)).toBe("new");
    expect(cachedFetch("https://example.com/keep", 1_002)).toBe("keep");
    expect(cachedFetch("https://example.com/0", 1_002)).toBeUndefined();
  });
});
