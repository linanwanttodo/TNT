import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
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
  fireNotification: vi.fn(async () => ({ blocked: false, results: [] })),
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

/**
 * "ask" in the reference is an escalation, not a shrug: a hook that answers ask
 * makes the call go to the human even when the policy would let it through.
 * Falling through to the policy let an auto-allowed call skip the prompt the
 * hook existed to force.
 */
describe("PreToolUse ask escalates to the prompt", () => {
  const excludeAll = {
    policies: [{ tool: "*", permission: "exclude" as const }],
  };

  beforeEach(() => {
    fireHooks.firePreToolUse.mockReset();
    fireHooks.firePreToolUse.mockResolvedValue({ blocked: false, results: [] });
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

  function hookAsks(reason: string) {
    fireHooks.firePreToolUse.mockResolvedValueOnce({
      blocked: false,
      permissionDecision: "ask",
      permissionDecisionReason: reason,
      results: [],
    });
  }

  it("prompts for a call the policy allows and shows the hook's reason", async () => {
    hookAsks("touching a protected path");
    const requestPermission = vi
      .spyOn(toolPermissionManager, "requestPermission")
      .mockResolvedValue({ approved: false } as never);

    const { chatHistoryEntries, hasRejection } = await executeStreamedToolCalls(
      [readCall("/x.txt")],
      { onToolPermissionRequest: vi.fn() },
      false,
      undefined,
      allowAll,
    );

    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Read",
        preview: expect.arrayContaining([
          expect.objectContaining({ content: "touching a protected path" }),
        ]),
      }),
    );
    expect(hasRejection).toBe(true);
    expect(chatHistoryEntries[0]?.status).toBe("canceled");
  });

  it("runs the call once the human answers the escalated prompt", async () => {
    hookAsks("confirm the delete");
    const requestPermission = vi
      .spyOn(toolPermissionManager, "requestPermission")
      .mockResolvedValue({
        approved: true,
      } as never);
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi
      .spyOn(toolsModule, "executeToolCall")
      .mockResolvedValue("done");

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [readCall("/x.txt")],
      { onToolPermissionRequest: vi.fn() },
      false,
      undefined,
      allowAll,
    );

    expect(requestPermission).toHaveBeenCalled();
    expect(executeToolCall).toHaveBeenCalled();
    expect(chatHistoryEntries[0]?.status).toBe("done");
    executeToolCall.mockRestore();
  });

  it("does not let a hook reopen a call the policy excludes", async () => {
    hookAsks("please confirm");
    // Answered rather than left hanging: if a regression did open a prompt,
    // this must fail on the assertion instead of on a 30s timeout.
    const requestPermission = vi
      .spyOn(toolPermissionManager, "requestPermission")
      .mockResolvedValue({ approved: false } as never);

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [readCall("/x.txt")],
      { onToolPermissionRequest: vi.fn() },
      false,
      undefined,
      excludeAll,
    );

    expect(requestPermission).not.toHaveBeenCalled();
    expect(chatHistoryEntries[0]?.status).toBe("canceled");
  });

  it("refuses an escalation in headless, where nobody can answer", async () => {
    hookAsks("please confirm");
    const requestPermission = vi
      .spyOn(toolPermissionManager, "requestPermission")
      .mockResolvedValue({ approved: false } as never);

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [readCall("/x.txt")],
      { onToolPermissionRequest: vi.fn() },
      true,
      undefined,
      allowAll,
    );

    expect(requestPermission).not.toHaveBeenCalled();
    expect(chatHistoryEntries[0]?.status).toBe("canceled");
  });
});
