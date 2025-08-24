import fs from "fs";
import os from "os";
import path from "path";

import { ContinueError } from "core/util/errors.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../config/env.js";

import { codebaseSearchTool } from "./codebaseSearch.js";

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
});
