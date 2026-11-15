import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { localPathOrUriToPath, localPathToUri } from "../util/pathToUri";

import { LanceDbIndex } from "./LanceDbIndex.js";

import type { IndexTag } from "../index.js";

/**
 * The vector half of retrieval, exercised offline: a deterministic fake
 * embeddings provider maps text to a small vector by topic word, so the test
 * proves the LanceDB write and the nearest-chunk read without model weights
 * or network access. CPU support and the native `vectordb` load are checked
 * by the code under test, so this fails loudly rather than skipping.
 */
let workspace: string;
let tag: IndexTag;
let alphaFile: string;
let betaFile: string;

const fakeProvider = {
  embeddingId: "test:topic-vector",
  maxEmbeddingChunkSize: 100,
  embed: async (texts: string[]): Promise<number[][]> =>
    texts.map((text) => {
      const vector = [0, 0, 0, 0];
      if (text.includes("alpha")) vector[0] = 1;
      if (text.includes("beta")) vector[1] = 1;
      return vector;
    }),
} as never;

function readFile(filepath: string): Promise<string> {
  return Promise.resolve(
    fs.readFileSync(localPathOrUriToPath(filepath), "utf-8"),
  );
}

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-lancedb-"));
  alphaFile = path.join(workspace, "alpha.ts");
  betaFile = path.join(workspace, "beta.ts");
  fs.writeFileSync(
    alphaFile,
    "export const alphaTopic = 'alpha alpha alpha';\n",
  );
  fs.writeFileSync(betaFile, "export const betaTopic = 'beta beta beta';\n");
  tag = {
    branch: "main",
    directory: localPathToUri(workspace),
    // The instance's artifactId embeds the provider id; a tag carrying the
    // static one would write to a different table than retrieve reads.
    artifactId: "",
  };
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("the vector index", () => {
  it("indexes chunks and returns the nearest one first", async () => {
    const index = await LanceDbIndex.create(fakeProvider, readFile);
    expect(index).not.toBeNull();
    tag.artifactId = index!.artifactId;

    const markComplete = vi.fn(async () => {});
    const items = [alphaFile, betaFile].map((file) => ({
      path: localPathToUri(file),
      cacheKey: `cache-${path.basename(file)}`,
    }));
    for await (const _ of index!.update(
      tag,
      { compute: items, del: [], addTag: [], removeTag: [] },
      markComplete as never,
      "test-repo",
    )) {
      // drive the generator to completion
    }

    const alphaHits = await index!.retrieve("alphaTopic", 1, [tag], undefined);
    expect(alphaHits[0]?.filepath).toBe(localPathToUri(alphaFile));

    const betaHits = await index!.retrieve("betaTopic", 1, [tag], undefined);
    expect(betaHits[0]?.filepath).toBe(localPathToUri(betaFile));
  }, 120_000);
});
