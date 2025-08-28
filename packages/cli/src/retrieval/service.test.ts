import fs from "fs";
import os from "os";
import path from "path";

import { ConfigHandler } from "core/config/ConfigHandler.js";
import { LLMLogger } from "core/llm/logger.js";
import FileSystemIde from "core/util/filesystem.js";
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

// A config that names an embeddings model no longer has to be a hosted one:
// the bundled local provider is selectable from the CLI.
const LOCAL_EMBEDDINGS_CONFIG = `name: local-embeddings
version: 0.0.1
models:
  - name: local-embed
    provider: transformers.js
    model: all-MiniLM-L6-v2
    roles:
      - embed
context:
  - provider: codebase
`;

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

  it("accepts the bundled local embeddings model", async () => {
    const configPath = path.join(env.continueHome, "config.yaml");
    fs.writeFileSync(configPath, LOCAL_EMBEDDINGS_CONFIG);
    try {
      const ide = new FileSystemIde(localPathToUri(workspace), "cli");
      const { config } = await new ConfigHandler(
        ide,
        new LLMLogger(),
      ).loadConfig();

      const embed = config?.modelsByRole.embed ?? [];
      expect(
        embed.some(
          (model: { providerName?: string }) =>
            model.providerName === "transformers.js",
        ),
      ).toBe(true);
    } finally {
      fs.writeFileSync(configPath, CONFIG);
    }
  }, 60_000);

  it("starts indexing without waiting for it", async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-index-start-"));
    fs.writeFileSync(
      path.join(fresh, "started.ts"),
      "export const startedMarker = 1;\n",
    );
    const service = new RetrievalService(fresh);

    service.startIndexing();

    // The call returns before the build lands - that is the point of the
    // background start - and a second call joins the run instead of doubling.
    expect(service.isIndexing()).toBe(true);
    service.startIndexing();

    const finished = await waitFor(async () => !service.isIndexing());
    expect(finished).toBe(true);
    expect(await service.hasIndex()).toBe(true);
    fs.rmSync(fresh, { recursive: true, force: true });
  }, 120_000);
});

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
