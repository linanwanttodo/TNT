import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolPermissionManager } from "../permissions/permissionManager.js";
import { hasSessionApproval } from "../permissions/sessionApprovals.js";
import { startNewSession } from "../session/index.js";
import { PreprocessedToolCall } from "../tools/types.js";

import { requestUserPermission } from "./permissionFlow.js";

function askCall(id: string, filepath: string): PreprocessedToolCall {
  return {
    id,
    name: "Write",
    arguments: { filepath, content: "data" },
    argumentsStr: JSON.stringify({ filepath, content: "data" }),
    startNotified: false,
    tool: {} as PreprocessedToolCall["tool"],
  };
}

/**
 * "Always this session" rides through the permission manager as a remember
 * flag on the answer; the engine's permission flow holds it in the approval
 * cache. That keeps the scope identical on every surface, which is what these
 * cases pin.
 */
describe("requestUserPermission remember handling", () => {
  let manager: ToolPermissionManager;

  beforeEach(() => {
    manager = new ToolPermissionManager();
    process.env.TNT_TEST_SESSION_ID = "permission-flow-remember";
    startNewSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager.removeAllListeners();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.TNT_TEST_SESSION_ID;
    startNewSession();
  });

  it("holds the approval for the session when the answer carries remember", async () => {
    const call = askCall("call_1", "/a.txt");
    const pending = requestUserPermission(
      call,
      { onToolPermissionRequest: vi.fn() },
      undefined,
      manager,
    );

    const requestId = manager.getPendingRequestIds()[0];
    manager.approveRequest(requestId, true);

    expect(await pending).toBe(true);
    expect(hasSessionApproval("Write", { filepath: "/a.txt" })).toBe(true);
  });

  it("does not hold an approval when the answer is remember-once", async () => {
    const call = askCall("call_1", "/a.txt");
    const pending = requestUserPermission(
      call,
      { onToolPermissionRequest: vi.fn() },
      undefined,
      manager,
    );

    const requestId = manager.getPendingRequestIds()[0];
    manager.approveRequest(requestId);

    expect(await pending).toBe(true);
    expect(hasSessionApproval("writeFile", { filepath: "/a.txt" })).toBe(false);
  });
});
