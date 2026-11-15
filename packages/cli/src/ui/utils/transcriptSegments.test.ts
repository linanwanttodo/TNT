import { describe, expect, it } from "vitest";

import { splitTranscriptSegments } from "./transcriptSegments.js";

describe("splitTranscriptSegments", () => {
  const items = ["a", "b", "c"];

  it("keeps the trailing item live while an answer streams", () => {
    expect(splitTranscriptSegments(items, 1)).toEqual({
      settled: ["a", "b"],
      live: ["c"],
    });
  });

  it("settles the whole transcript once nothing is changing", () => {
    expect(splitTranscriptSegments(items, 0)).toEqual({
      settled: ["a", "b", "c"],
      live: [],
    });
  });

  it("never lets the live window swallow the transcript", () => {
    expect(splitTranscriptSegments(items, 9)).toEqual({
      settled: [],
      live: ["a", "b", "c"],
    });
  });

  it("treats a negative window as settled", () => {
    expect(splitTranscriptSegments(items, -2)).toEqual({
      settled: ["a", "b", "c"],
      live: [],
    });
  });

  it("reports nothing to print for an empty transcript", () => {
    expect(splitTranscriptSegments([], 1)).toEqual({ settled: [], live: [] });
  });

  it("preserves order across the split", () => {
    const { settled, live } = splitTranscriptSegments(items, 2);

    expect([...settled, ...live]).toEqual(items);
  });
});
