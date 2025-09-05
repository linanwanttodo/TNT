import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { readFileTool } from "../tools/readFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";

import { executeStreamedToolCalls } from "./streamChatResponse.helpers.js";

const empty = (): Partial<HookEventResult> => ({ blocked: false, results: [] });

const fireHooks = vi.hoisted(() => ({
  firePreToolUse: vi.fn(async (..._args: unknown[]) => ({
    blocked: false,
    results: [],
  })),
  firePostToolUse: vi.fn(
    async (..._args: unknown[]): Promise<Partial<HookEventResult>> => ({
      blocked: false,
      results: [],
    }),
  ),
  firePostToolUseFailure: vi.fn(async (..._args: unknown[]) => ({
    blocked: false,
    results: [],
  })),
  firePermissionRequest: vi.fn(async (..._args: unknown[]) => ({
    blocked: false,
    results: [],
  })),
}));
vi.mock("../hooks/fireHook.js", () => ({
  firePreToolUse: (...args: unknown[]) => fireHooks.firePreToolUse(...args),
  firePostToolUse: (...args: unknown[]) => fireHooks.firePostToolUse(...args),
  firePostToolUseFailure: (...args: unknown[]) =>
    fireHooks.firePostToolUseFailure(...args),
  firePermissionRequest: (...args: unknown[]) =>
    fireHooks.firePermissionRequest(...args),
}));

const allowAll = { policies: [{ tool: "*", permission: "allow" as const }] };

const call: PreprocessedToolCall = {
  id: "call_spill",
  name: "Bash",
  arguments: { command: "make" },
  argumentsStr: '{"command":"make"}',
  startNotified: false,
  tool: readFileTool,
};

let globalDir: string;
let previous: Record<string, string | undefined>;

beforeEach(() => {
  previous = {
    CONTINUE_GLOBAL_DIR: process.env.CONTINUE_GLOBAL_DIR,
    CONTINUE_CLI_MAX_TOOL_RESULT_CHARS:
      process.env.CONTINUE_CLI_MAX_TOOL_RESULT_CHARS,
    CONTINUE_CLI_TEST_SESSION_ID: process.env.CONTINUE_CLI_TEST_SESSION_ID,
  };
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-spill-loop-"));
  process.env.CONTINUE_GLOBAL_DIR = globalDir;
  process.env.CONTINUE_CLI_MAX_TOOL_RESULT_CHARS = "100";
  process.env.CONTINUE_CLI_TEST_SESSION_ID = "test-session";
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(globalDir, { recursive: true, force: true });
});

/**
 * The loop, not just the store: what the model is answered must be the short
 * version with a reachable path, and a hook's note must survive next to it.
 */
describe("oversized result through the tool loop", () => {
  it("answers with a preview and keeps both the bytes and the hook note", async () => {
    const buildLog = `build started\n${"l".repeat(60_000)}`;
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi
      .spyOn(toolsModule, "executeToolCall")
      .mockResolvedValue(buildLog);
    fireHooks.firePostToolUse.mockResolvedValueOnce({
      ...empty(),
      additionalContext: "the failing target is listed at the end",
    });

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [call],
      undefined,
      false,
      undefined,
      allowAll,
    );

    const content = String(chatHistoryEntries[0]?.content);
    expect(content.length).toBeLessThan(buildLog.length / 10);
    expect(content).toContain("build started");
    expect(content).toContain(
      "<system-reminder>PostToolUse:Bash hook additional context: the failing target is listed at the end</system-reminder>",
    );

    const stored = path.join(
      globalDir,
      "tool-results",
      "test-session",
      "call_spill.txt",
    );
    expect(content).toContain(stored);
    expect(fs.readFileSync(stored, "utf-8")).toBe(buildLog);
    executeToolCall.mockRestore();
  });
});
