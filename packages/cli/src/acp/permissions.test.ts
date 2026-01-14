import type * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toolPermissionManager } from "../permissions/permissionManager.js";
import {
  clearSessionApprovals,
  hasSessionApproval,
} from "../permissions/sessionApprovals.js";

import { requestToolPermission } from "./permissions.js";

function clientResponse(outcome: acp.RequestPermissionResponse["outcome"]): {
  client: acp.AgentContext;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async () => ({ outcome }));
  return {
    client: { request } as unknown as acp.AgentContext,
    request,
  };
}

async function pendingPermission(): Promise<{
  requestId: string;
  result: Promise<{ approved: boolean }>;
}> {
  const requested = new Promise<{ requestId: string }>((resolve) => {
    toolPermissionManager.once("permissionRequested", resolve);
  });
  const result = toolPermissionManager.requestPermission({
    name: "Write",
    arguments: { filepath: "notes.txt" },
  });
  const event = await requested;
  return { requestId: event.requestId, result };
}

afterEach(() => {
  clearSessionApprovals();
});

describe("ACP permission bridge", () => {
  it("maps allow_once to an approval and forwards the tool call id", async () => {
    const { client, request } = clientResponse({
      outcome: "selected",
      optionId: "allow_once",
    });
    const pending = await pendingPermission();

    requestToolPermission({
      client,
      sessionId: "session-1",
      toolName: "Write",
      toolArgs: { filepath: "notes.txt" },
      requestId: pending.requestId,
      toolCallId: "call-1",
      signal: new AbortController().signal,
    });

    await expect(pending.result).resolves.toEqual({
      approved: true,
      remember: false,
    });
    expect(request).toHaveBeenCalledWith(
      "session/request_permission",
      expect.objectContaining({
        sessionId: "session-1",
        toolCall: expect.objectContaining({
          toolCallId: "call-1",
          kind: "edit",
          status: "pending",
        }),
      }),
      expect.any(Object),
    );
  });

  it("maps allow_always to a session approval", async () => {
    const { client } = clientResponse({
      outcome: "selected",
      optionId: "allow_always",
    });
    const pending = await pendingPermission();

    requestToolPermission({
      client,
      sessionId: "session-1",
      toolName: "Write",
      toolArgs: { filepath: "notes.txt" },
      requestId: pending.requestId,
      toolCallId: "call-1",
      signal: new AbortController().signal,
    });

    await expect(pending.result).resolves.toEqual({
      approved: true,
      remember: true,
    });
    expect(hasSessionApproval("Write", { filepath: "notes.txt" })).toBe(true);
  });

  it("treats a cancelled or failed request as a rejection", async () => {
    const cancelled = await pendingPermission();
    requestToolPermission({
      client: clientResponse({ outcome: "cancelled" }).client,
      sessionId: "session-1",
      toolName: "Write",
      toolArgs: {},
      requestId: cancelled.requestId,
      signal: new AbortController().signal,
    });
    await expect(cancelled.result).resolves.toEqual({ approved: false });

    const failed = await pendingPermission();
    requestToolPermission({
      client: {
        request: vi.fn(async () => {
          throw new Error("client went away");
        }),
      } as unknown as acp.AgentContext,
      sessionId: "session-1",
      toolName: "Write",
      toolArgs: {},
      requestId: failed.requestId,
      signal: new AbortController().signal,
    });
    await expect(failed.result).resolves.toEqual({ approved: false });
  });
});
