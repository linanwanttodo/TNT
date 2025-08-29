import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { readFileTool } from "../tools/readFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";

import { executeStreamedToolCalls } from "./streamChatResponse.helpers.js";

const fireHooks = vi.hoisted(() => ({
  firePreToolUse: vi.fn(
    async (..._args: unknown[]): Promise<Partial<HookEventResult>> => ({
      blocked: false,
      results: [],
    }),
  ),
}));
vi.mock("../hooks/fireHook.js", () => ({
  firePreToolUse: (...args: unknown[]) => fireHooks.firePreToolUse(...args),
  firePostToolUse: vi.fn(async () => ({ blocked: false, results: [] })),
  firePostToolUseFailure: vi.fn(async () => ({ blocked: false, results: [] })),
  firePermissionRequest: vi.fn(async () => ({ blocked: false, results: [] })),
}));

const allowAll = { policies: [{ tool: "*", permission: "allow" as const }] };
const askAll = { policies: [{ tool: "*", permission: "ask" as const }] };

function readCall(filepath: string): PreprocessedToolCall {
  return {
    id: "call_1",
    name: "Read",
    arguments: { filepath },
    argumentsStr: JSON.stringify({ filepath }),
    startNotified: false,
    tool: readFileTool,
  };
}

/**
 * The PreToolUse hook's stdout contract (rewritten input, explicit allow)
 * was parsed but dropped: the consumer only read `blocked`, and hooks ran
 * after the permission check instead of before it.
 */
describe("PreToolUse decisions at execution time", () => {
  beforeEach(() => {
    fireHooks.firePreToolUse.mockReset();
    fireHooks.firePreToolUse.mockResolvedValue({ blocked: false, results: [] });
  });

  it("executes the input a hook rewrote", async () => {
    fireHooks.firePreToolUse.mockResolvedValueOnce({
      blocked: false,
      updatedInput: { filepath: "/rewritten.txt" },
      results: [],
    });
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi
      .spyOn(toolsModule, "executeToolCall")
      .mockResolvedValue("file body");

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [readCall("/original.txt")],
      undefined,
      false,
      undefined,
      allowAll,
    );

    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: { filepath: "/rewritten.txt" },
      }),
      expect.anything(),
    );
    expect(chatHistoryEntries[0]?.status).toBe("done");
    executeToolCall.mockRestore();
  });

  it("lets a hook allow a call the policy would deny in headless", async () => {
    fireHooks.firePreToolUse.mockResolvedValueOnce({
      blocked: false,
      permissionDecision: "allow",
      results: [],
    });
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi
      .spyOn(toolsModule, "executeToolCall")
      .mockResolvedValue("file body");

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [readCall("/x.txt")],
      undefined,
      true,
      undefined,
      askAll,
    );

    expect(executeToolCall).toHaveBeenCalled();
    expect(chatHistoryEntries[0]?.status).toBe("done");
    executeToolCall.mockRestore();
  });

  it("still denies a policy ask in headless without a hook allow", async () => {
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi.spyOn(toolsModule, "executeToolCall");

    const { chatHistoryEntries, hasRejection } = await executeStreamedToolCalls(
      [readCall("/x.txt")],
      undefined,
      true,
      undefined,
      askAll,
    );

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(hasRejection).toBe(true);
    expect(chatHistoryEntries[0]?.status).toBe("canceled");
    expect(String(chatHistoryEntries[0]?.content)).toContain("security policy");
    executeToolCall.mockRestore();
  });
});
