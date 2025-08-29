import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import { readFileTool } from "../tools/readFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";

import { checkToolPermissionApproval } from "./streamChatResponse.helpers.js";

const fireHooks = vi.hoisted(() => ({
  fireNotification: vi.fn(async (..._args: unknown[]) => ({
    blocked: false,
    results: [],
  })),
  firePermissionRequest: vi.fn(
    async (..._args: unknown[]): Promise<Partial<HookEventResult>> => ({
      blocked: false,
      results: [],
    }),
  ),
}));
vi.mock("../hooks/fireHook.js", () => ({
  fireNotification: (...args: unknown[]) => fireHooks.fireNotification(...args),
  firePermissionRequest: (...args: unknown[]) =>
    fireHooks.firePermissionRequest(...args),
  firePreToolUse: vi.fn(async () => ({ blocked: false, results: [] })),
  firePostToolUse: vi.fn(async () => ({ blocked: false, results: [] })),
  firePostToolUseFailure: vi.fn(async () => ({ blocked: false, results: [] })),
}));

const askAll = { policies: [{ tool: "*", permission: "ask" as const }] };

const bashCall: PreprocessedToolCall = {
  id: "call_1",
  name: "Bash",
  arguments: { command: "ls" },
  argumentsStr: '{"command":"ls"}',
  startNotified: false,
  tool: readFileTool,
};

/**
 * Notification had a builder but no caller: a permission prompt opened with
 * nothing telling notifier hooks, which is what the reference sends the
 * "permission_prompt" notification for.
 */
describe("permission-prompt notifications", () => {
  beforeEach(() => {
    fireHooks.fireNotification.mockClear();
    fireHooks.firePermissionRequest.mockClear();
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

  it("fires a permission_prompt notification when a prompt opens", async () => {
    vi.spyOn(toolPermissionManager, "requestPermission").mockResolvedValue({
      approved: false,
    } as never);

    const result = await checkToolPermissionApproval(
      askAll as never,
      bashCall,
      { onToolPermissionRequest: vi.fn() },
      false,
    );

    expect(fireHooks.fireNotification).toHaveBeenCalledWith(
      expect.stringContaining("Bash"),
      "permission_prompt",
      "Bash",
    );
    expect(result.approved).toBe(false);
  });

  it("does not notify when a hook already decided", async () => {
    fireHooks.firePermissionRequest.mockResolvedValueOnce({
      blocked: false,
      results: [],
      permissionRequestDecision: { behavior: "allow" },
    });

    const result = await checkToolPermissionApproval(
      askAll as never,
      bashCall,
      { onToolPermissionRequest: vi.fn() },
      false,
    );

    expect(result.approved).toBe(true);
    expect(fireHooks.fireNotification).not.toHaveBeenCalled();
  });
});
