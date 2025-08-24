import { describe, expect, it } from "vitest";

import { RetrievalHit, mergeHits } from "./service.js";

function hit(filepath: string, startLine = 1, endLine = 2): RetrievalHit {
  return { filepath, startLine, endLine, content: `content of ${filepath}` };
}

describe("merging search results", () => {
  it("keeps the primary order and appends secondary hits", () => {
    const merged = mergeHits([hit("a.ts"), hit("b.ts")], [hit("c.ts")], 10);

    expect(merged.map((entry) => entry.filepath)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
  });

  it("drops a secondary hit that repeats a primary chunk", () => {
    const merged = mergeHits(
      [hit("a.ts", 1, 5)],
      [hit("a.ts", 1, 5), hit("b.ts")],
      10,
    );

    expect(merged.map((entry) => entry.filepath)).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps two ranges of the same file apart", () => {
    const merged = mergeHits([hit("a.ts", 1, 5)], [hit("a.ts", 6, 9)], 10);

    expect(merged).toHaveLength(2);
  });

  it("caps the combined list", () => {
    const merged = mergeHits(
      [hit("a.ts"), hit("b.ts")],
      [hit("c.ts"), hit("d.ts")],
      3,
    );

    expect(merged.map((entry) => entry.filepath)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
  });

  it("does not exceed the cap when the primary list is already longer", () => {
    const merged = mergeHits([hit("a.ts"), hit("b.ts"), hit("c.ts")], [], 2);

    expect(merged).toHaveLength(2);
  });
});
