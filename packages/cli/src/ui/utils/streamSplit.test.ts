import { describe, expect, it } from "vitest";

import { findLastSafeSplitPoint } from "./streamSplit.js";

describe("findLastSafeSplitPoint", () => {
  it("splits after the last blank line outside a fence", () => {
    expect(findLastSafeSplitPoint("a\n\nb")).toBe(3);
    expect(findLastSafeSplitPoint("a\n\nb\n\nc")).toBe(6);
  });

  it("keeps an unclosed fence in the live tail", () => {
    const content = "a\n\n```ts\nconst x = 1;";
    expect(findLastSafeSplitPoint(content)).toBe(3);
  });

  it("splits after a closed fence", () => {
    const content = "```\ncode\n```\n\ntail";
    expect(findLastSafeSplitPoint(content)).toBe(content.length - 4);
  });

  it("returns the whole length when no safe boundary exists", () => {
    expect(findLastSafeSplitPoint("a\nb")).toBe(3);
    expect(findLastSafeSplitPoint("")).toBe(0);
  });
});
