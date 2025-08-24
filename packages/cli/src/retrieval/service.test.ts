import fs from "fs";
import os from "os";
import path from "path";

import { localPathToUri } from "core/util/pathToUri.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../config/env.js";

import { RetrievalService } from "./service.js";

/**
 * The service is the CLI's host for core's codebase indexer. The global
 * directory is the per-worker temp directory, so the index database and the
 * config this test writes are thrown away with the worker.
 */
let workspace: string;
let symbolFile: string;

const CONFIG = `name: retrieval-test
version: 0.0.1
models:
  - name: test-chat
    provider: openai
    model: gpt-4
    roles:
      - chat
    apiKey: test
context:
  - provider: codebase
`;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-retrieval-"));
  symbolFile = path.join(workspace, "src", "math.ts");
  fs.mkdirSync(path.dirname(symbolFile), { recursive: true });
  fs.writeFileSync(
    symbolFile,
    "export function computeFibonacciSequence(n: number): number {\n  return n;\n}\n",
  );
  fs.writeFileSync(
    path.join(workspace, "README.md"),
    "# Example project\n\nNothing else to see here.\n",
  );
  fs.writeFileSync(path.join(env.continueHome, "config.yaml"), CONFIG);
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("retrieval over the workspace", () => {
  it("finds a symbol after the index is built", async () => {
    const service = new RetrievalService(workspace);

    await service.update();
    const hits = await service.search("computeFibonacciSequence");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].filepath).toBe(localPathToUri(symbolFile));
    expect(hits[0].content).toContain("computeFibonacciSequence");
    expect(hits[0].endLine).toBeGreaterThanOrEqual(hits[0].startLine);
  }, 120_000);

  it("finds nothing for a query the workspace does not contain", async () => {
    const service = new RetrievalService(workspace);

    const hits = await service.search("zzz_no_such_symbol_zzz");

    expect(hits).toEqual([]);
  }, 120_000);
});
