import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolPermissionManager } from "../permissions/permissionManager.js";
import { PreprocessedToolCall } from "../tools/types.js";

import { requestUserPermission } from "./permissionFlow.js";

function askCall(id: string, filepath: string): PreprocessedToolCall {
  return {
    id,
    name: "writeFile",
    arguments: { filepath, content: "data" },
    argumentsStr: JSON.stringify({ filepath, content: "data" }),
    startNotified: false,
    tool: {} as PreprocessedToolCall["tool"],
  };
}

describe("requestUserPermission", () => {
  let manager: ToolPermissionManager;

  beforeEach(() => {
    manager = new ToolPermissionManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager.removeAllListeners();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pairs a concurrent same-name request with its own call id", async () => {
    const first = askCall("call_1", "/a.txt");
    const second = askCall("call_2", "/b.txt");
    const seenRequestIds: string[] = [];

    const firstResult = requestUserPermission(
      first,
      {
        onToolPermissionRequest: (_name, _args, requestId) => {
          seenRequestIds.push(requestId);
        },
      },
      undefined,
      manager,
    );
    const secondResult = requestUserPermission(
      second,
      {
        onToolPermissionRequest: (_name, _args, requestId) => {
          seenRequestIds.push(requestId);
        },
      },
      undefined,
      manager,
    );

    expect(seenRequestIds).toEqual(["tool-request-1", "tool-request-2"]);

    const pendingIds = manager.getPendingRequestIds();
    manager.approveRequest(pendingIds[1]);
    manager.rejectRequest(pendingIds[0]);

    expect(await firstResult).toBe(false);
    expect(await secondResult).toBe(true);
  });

  it("fails closed when no surface answers within the timeout", async () => {
    const promise = requestUserPermission(
      askCall("call_1", "/a.txt"),
      { onToolPermissionRequest: vi.fn() },
      undefined,
      manager,
    );

    await vi.advanceTimersByTimeAsync(300_000);

    expect(await promise).toBe(false);
    expect(manager.getPendingRequestIds()).toHaveLength(0);
  });

  it("keeps the request pending when the timeout is not reached", async () => {
    const promise = requestUserPermission(
      askCall("call_1", "/a.txt"),
      { onToolPermissionRequest: vi.fn() },
      undefined,
      manager,
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(manager.getPendingRequestIds()).toHaveLength(1);

    const pendingId = manager.getPendingRequestIds()[0];
    manager.approveRequest(pendingId);
    expect(await promise).toBe(true);
    expect(manager.getPendingRequestIds()).toHaveLength(0);
  });
});
