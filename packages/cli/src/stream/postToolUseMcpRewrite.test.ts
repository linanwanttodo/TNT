import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import { readFileTool } from "../tools/readFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";

const fireHooks = vi.hoisted(() => ({
  firePreToolUse: vi.fn(
    async (..._args: unknown[]): Promise<Partial<HookEventResult>> => ({
      blocked: false,
      results: [],
    }),
  ),
  firePostToolUse: vi.fn(
    async (..._args: unknown[]): Promise<Partial<HookEventResult>> => ({
      blocked: false,
      results: [],
    }),
  ),
}));
vi.mock("../hooks/fireHook.js", () => ({
  firePreToolUse: (...args: unknown[]) => fireHooks.firePreToolUse(...args),
  firePostToolUse: (...args: unknown[]) => fireHooks.firePostToolUse(...args),
  firePostToolUseFailure: vi.fn(async () => ({ blocked: false, results: [] })),
  firePermissionRequest: vi.fn(async () => ({ blocked: false, results: [] })),
  fireNotification: vi.fn(async () => ({ blocked: false, results: [] })),
}));

const allowAll = { policies: [{ tool: "*", permission: "allow" as const }] };

function call(name: string): PreprocessedToolCall {
  return {
    id: "call_1",
    name,
    arguments: { filepath: "/x.txt" },
    argumentsStr: JSON.stringify({ filepath: "/x.txt" }),
    startNotified: false,
    tool: readFileTool,
  };
}

async function run(name: string) {
  const toolsModule = await import("../tools/index.js");
  const executeToolCall = vi
    .spyOn(toolsModule, "executeToolCall")
    .mockResolvedValue("original body");
  try {
    const { executeStreamedToolCalls } =
      await import("./streamChatResponse.helpers.js");
    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [call(name)],
      undefined,
      false,
      undefined,
      { permissions: allowAll },
    );
    return String(chatHistoryEntries[0]?.content);
  } finally {
    executeToolCall.mockRestore();
  }
}

/**
 * The reference lets a PostToolUse hook rewrite an MCP tool's output
 * (updatedMCPToolOutput). The rewrite lands in what the model reads - and
 * only for tools the mcp__ prefix marks as MCP; every other tool's result is
 * ours to describe, so a rewrite for one is ignored with a note.
 */
describe("PostToolUse updatedMCPToolOutput", () => {
  beforeEach(() => {
    fireHooks.firePreToolUse.mockReset();
    fireHooks.firePreToolUse.mockResolvedValue({ blocked: false, results: [] });
    fireHooks.firePostToolUse.mockReset();
    fireHooks.firePostToolUse.mockResolvedValue({
      blocked: false,
      results: [],
    });
    vi.spyOn(toolPermissionManager, "on").mockImplementation(
      () => toolPermissionManager as never,
    );
    vi.spyOn(toolPermissionManager, "off").mockImplementation(
      () => toolPermissionManager as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces an mcp__ tool's result with the hook's text and a reminder", async () => {
    fireHooks.firePostToolUse.mockResolvedValue({
      blocked: false,
      results: [],
      updatedMCPToolOutput: "rewritten body",
    });

    const content = await run("mcp__github__get_file");

    expect(content).toContain(
      "<system-reminder>MCP tool output rewritten by PostToolUse hook</system-reminder>",
    );
    expect(content).toContain("rewritten body");
    expect(content).not.toContain("original body");
  });

  it("leaves a non-MCP tool's result alone", async () => {
    fireHooks.firePostToolUse.mockResolvedValue({
      blocked: false,
      results: [],
      updatedMCPToolOutput: "rewritten body",
    });

    const content = await run("Read");

    expect(content).toContain("original body");
    expect(content).not.toContain("rewritten body");
    expect(content).not.toContain(
      "MCP tool output rewritten by PostToolUse hook",
    );
  });

  it("keeps the result as executed when the hook sends no rewrite", async () => {
    const content = await run("mcp__github__get_file");

    expect(content).toContain("original body");
    expect(content).not.toContain(
      "MCP tool output rewritten by PostToolUse hook",
    );
  });
});
