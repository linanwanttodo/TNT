import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { spillOversizedToolResult } from "./toolResultStorage.js";

let globalDir: string;
let previousGlobalDir: string | undefined;
let previousLimit: string | undefined;
let previousSessionId: string | undefined;

function resultsDir(sessionId?: string): string {
  const dir = sessionId ?? "test-session";
  return path.join(globalDir, "tool-results", dir);
}

beforeEach(() => {
  previousGlobalDir = process.env.CONTINUE_GLOBAL_DIR;
  previousLimit = process.env.CONTINUE_CLI_MAX_TOOL_RESULT_CHARS;
  previousSessionId = process.env.CONTINUE_CLI_TEST_SESSION_ID;
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-tool-results-"));
  process.env.CONTINUE_GLOBAL_DIR = globalDir;
  process.env.CONTINUE_CLI_MAX_TOOL_RESULT_CHARS = "100";
  // The session the store files results under.
  process.env.CONTINUE_CLI_TEST_SESSION_ID = "test-session";
});

afterEach(() => {
  if (previousGlobalDir === undefined) {
    delete process.env.CONTINUE_GLOBAL_DIR;
  } else {
    process.env.CONTINUE_GLOBAL_DIR = previousGlobalDir;
  }
  if (previousLimit === undefined) {
    delete process.env.CONTINUE_CLI_MAX_TOOL_RESULT_CHARS;
  } else {
    process.env.CONTINUE_CLI_MAX_TOOL_RESULT_CHARS = previousLimit;
  }
  if (previousSessionId === undefined) {
    delete process.env.CONTINUE_CLI_TEST_SESSION_ID;
  } else {
    process.env.CONTINUE_CLI_TEST_SESSION_ID = previousSessionId;
  }
  fs.rmSync(globalDir, { recursive: true, force: true });
});

describe("spillOversizedToolResult", () => {
  it("hands a result within the limit straight through", async () => {
    const content = "a".repeat(50);

    const result = await spillOversizedToolResult({
      toolName: "Read",
      callId: "call_small",
      content,
    });

    expect(result).toBe(content);
    expect(fs.existsSync(path.join(globalDir, "tool-results"))).toBe(false);
  });

  it("stores the whole result and hands back the head plus its path", async () => {
    const content = `${"head marker\n"}${"x".repeat(5_000)}`;

    const result = await spillOversizedToolResult({
      toolName: "Bash",
      callId: "call_big",
      content,
    });

    const stored = path.join(resultsDir(), "call_big.txt");
    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain("head marker");
    expect(result).toContain(stored);
    expect(fs.readFileSync(stored, "utf-8")).toBe(content);
  });

  it("keeps a path-shaped call id inside the session directory", async () => {
    const content = "y".repeat(500);

    await spillOversizedToolResult({
      toolName: "Bash",
      callId: "../../../../escape",
      content,
    });

    const files = fs.readdirSync(resultsDir());
    expect(files).toHaveLength(1);
    expect(fs.existsSync(path.join(globalDir, "escape.txt"))).toBe(false);
  });

  it("still shortens the result when it cannot be stored", async () => {
    // A path under a plain file cannot be created, so the store fails.
    const blocker = path.join(globalDir, "blocker");
    fs.writeFileSync(blocker, "not a directory");
    process.env.CONTINUE_GLOBAL_DIR = path.join(blocker, "sub");
    const content = "z".repeat(500);

    const result = await spillOversizedToolResult({
      toolName: "Bash",
      callId: "call_unstored",
      content,
    });

    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain("could not be saved");
  });

  it("prunes to the newest stored results", async () => {
    const dir = resultsDir();
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 55; i++) {
      const file = path.join(dir, `old_${i}.txt`);
      fs.writeFileSync(file, "x");
      // Distinct mtimes, so "newest" is not decided by a same-millisecond tie.
      const when = new Date(1_700_000_000_000 + i * 1_000);
      fs.utimesSync(file, when, when);
    }

    await spillOversizedToolResult({
      toolName: "Bash",
      callId: "call_newest",
      content: "w".repeat(500),
    });

    const remaining = fs.readdirSync(dir);
    expect(remaining).toContain("call_newest.txt");
    expect(remaining).toHaveLength(50);
    expect(remaining).not.toContain("old_0.txt");
    expect(remaining).toContain("old_49.txt");
  });
});
