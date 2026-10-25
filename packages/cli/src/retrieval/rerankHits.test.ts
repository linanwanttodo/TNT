import { describe, expect, it, vi } from "vitest";

import { rerankHits, type RetrievalHit } from "./service.js";

function hit(filepath: string, content: string, startLine = 1): RetrievalHit {
  return { filepath, content, startLine, endLine: startLine };
}

const hits = [
  hit("/a.ts", "alpha", 1),
  hit("/b.ts", "bravo", 2),
  hit("/c.ts", "charlie", 3),
];

describe("rerankHits", () => {
  it("keeps the merged order when no reranker is configured", async () => {
    expect(await rerankHits(undefined, "query", hits)).toBe(hits);
  });

  it("reorders by score, keeps ties in their original order", async () => {
    const reranker = {
      rerank: vi.fn(async () => [0.1, 0.9, 0.9]),
    };

    const ordered = await rerankHits(reranker, "query", hits);

    expect(ordered.map((entry) => entry.filepath)).toEqual([
      "/b.ts",
      "/c.ts",
      "/a.ts",
    ]);
  });

  it("passes the hit text and location to the reranker", async () => {
    const reranker = {
      rerank: vi.fn(async () => [1, 1, 1]),
    };

    await rerankHits(reranker, "query", hits);

    expect(reranker.rerank).toHaveBeenCalledWith("query", [
      expect.objectContaining({
        content: "alpha",
        filepath: "/a.ts",
        startLine: 1,
        endLine: 1,
        index: 0,
      }),
      expect.objectContaining({
        content: "bravo",
        filepath: "/b.ts",
        index: 1,
      }),
      expect.objectContaining({
        content: "charlie",
        filepath: "/c.ts",
        index: 2,
      }),
    ]);
  });

  it("keeps the order when the reranker returns the wrong number of scores", async () => {
    const reranker = { rerank: vi.fn(async () => [1]) };

    expect(await rerankHits(reranker, "query", hits)).toBe(hits);
  });

  it("keeps the order when the reranker throws", async () => {
    const reranker = {
      rerank: vi.fn(async () => {
        throw new Error("reranker down");
      }),
    };

    expect(await rerankHits(reranker, "query", hits)).toBe(hits);
  });

  it("does not call a reranker for a single hit", async () => {
    const reranker = { rerank: vi.fn(async () => [1]) };

    await rerankHits(reranker, "query", [hits[0]]);

    expect(reranker.rerank).not.toHaveBeenCalled();
  });
});
