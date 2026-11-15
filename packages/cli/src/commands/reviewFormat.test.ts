import { describe, expect, it } from "vitest";

import { unsupportedReviewFormat } from "./reviewFormat.js";

describe("which --format values review accepts", () => {
  it("accepts the two the renderer can produce, and no value at all", () => {
    expect(unsupportedReviewFormat(undefined)).toBeNull();
    expect(unsupportedReviewFormat("text")).toBeNull();
    expect(unsupportedReviewFormat("json")).toBeNull();
  });

  it("refuses anything else instead of rendering it as text", () => {
    expect(unsupportedReviewFormat("xml")).toBe("xml");
    expect(unsupportedReviewFormat("JSON")).toBe("JSON");
  });
});
