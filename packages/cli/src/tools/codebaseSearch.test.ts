import fs from "fs";
import os from "os";
import path from "path";

import { ContinueError } from "core/util/errors.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../config/env.js";
import { getRetrievalService } from "../retrieval/service.js";
import { scheduleFileRefresh } from "../retrieval/writeRefresh.js";

import { codebaseSearchTool } from "./codebaseSearch.js";
import { writeFileTool } from "./writeFile.js";

vi.mock("../telemetry/telemetryService.js");

/**
 * The tool works on the current working directory, which is how the CLI
 * defines a workspace, so the suite moves into a temp workspace and back.
 * The config and the index database land in the per-worker global directory.
 */
let workspace: string;
let symbolFile: string;
const originalCwd = process.cwd();

const CONFIG = `name: search-tool-test
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
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-search-"));
  symbolFile = path.join(workspace, "src", "math.ts");
  fs.mkdirSync(path.dirname(symbolFile), { recursive: true });
  fs.writeFileSync(
    symbolFile,
    "export function computeFibonacciSequence(n: number): number {\n  return n;\n}\n",
  );
  fs.writeFileSync(path.join(env.continueHome, "config.yaml"), CONFIG);
  process.chdir(workspace);
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(workspace, { recursive: true, force: true });
});

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 20_000,
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

describe("the codebase search tool", () => {
  it("builds the index on first use and finds the symbol", async () => {
    const result = await codebaseSearchTool.run({
      query: "computeFibonacciSequence",
    });

    expect(result).toContain(symbolFile);
    expect(result).toMatch(/:\d+:\d+/);
    expect(result).toContain("computeFibonacciSequence");
  }, 120_000);

  it("says so when nothing matches", async () => {
    const result = await codebaseSearchTool.run({
      query: "zzz_no_such_symbol_zzz",
    });

    expect(result).toContain("No matches");
  }, 120_000);

  it("refuses an empty query before running", async () => {
    await expect(
      codebaseSearchTool.preprocess!({ query: "  " }),
    ).rejects.toBeInstanceOf(ContinueError);
    await expect(
      codebaseSearchTool.run({ query: "  " }),
    ).rejects.toBeInstanceOf(ContinueError);
  });

  it("picks up a file written by a tool", async () => {
    const written = path.join(workspace, "src", "written.ts");
    await writeFileTool.run({
      filepath: written,
      content: "export const writtenByToolMarker = 1;\n",
    });

    const found = await waitFor(async () => {
      const hits = await getRetrievalService().search("writtenByToolMarker");
      return hits.length > 0;
    });

    expect(found).toBe(true);
  }, 60_000);

  it("does not build an index for a change on its own", async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-search-fresh-"));
    const changed = path.join(fresh, "changed.ts");
    fs.writeFileSync(changed, "export const freshMarker = 1;\n");

    const insideWorkspace = process.cwd();
    process.chdir(fresh);
    scheduleFileRefresh(changed);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const indexed = await getRetrievalService().hasIndex();
    process.chdir(insideWorkspace);

    expect(indexed).toBe(false);
    fs.rmSync(fresh, { recursive: true, force: true });
  }, 30_000);
});
