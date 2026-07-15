import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toolPermissionManager } from "../permissions/permissionManager.js";
import {
  clearSessionApprovals,
  grantSessionFullAccess,
} from "../permissions/sessionApprovals.js";
import type { ToolPermissions } from "../permissions/types.js";
import { services } from "../services/index.js";
import { startNewSession } from "../session/index.js";
import type { PreprocessedToolCall } from "../tools/types.js";

import { checkToolPermissionApproval } from "./permissionFlow.js";

const bashAskPolicies = {
  policies: [{ tool: "Bash", permission: "ask" }],
} as unknown as ToolPermissions;

function bashCall(command: string): PreprocessedToolCall {
  return {
    id: "call-1",
    name: "Bash",
    arguments: { command },
    argumentsStr: JSON.stringify({ command }),
    startNotified: false,
    tool: {} as PreprocessedToolCall["tool"],
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * A full-access grant answers ordinary asks for its own session, but it is not
 * a process-wide bypass: another session still prompts, and the mechanical
 * destructive-command gate still asks even in the granted session.
 */
describe("session-scoped full access", () => {
  beforeEach(() => {
    // The prompt flow under test lives in default mode; auto is the startup
    // mode and hands every ask to its classifier first.
    services.toolPermissions.switchMode("default");
    startNewSession();
    clearSessionApprovals();
    grantSessionFullAccess();
  });

  afterEach(() => {
    for (const requestId of toolPermissionManager.getPendingRequestIds()) {
      toolPermissionManager.rejectRequest(requestId);
    }
    clearSessionApprovals();
    startNewSession();
  });

  it("allows an ordinary ask without prompting in the granted session", async () => {
    const onAsk = vi.fn();

    const result = await checkToolPermissionApproval(
      bashAskPolicies,
      bashCall("ls -la"),
      { onToolPermissionRequest: onAsk },
    );

    expect(result.approved).toBe(true);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("answers the ask in a headless process when the session has a grant", async () => {
    const onAsk = vi.fn();

    const result = await checkToolPermissionApproval(
      bashAskPolicies,
      bashCall("ls -la"),
      { onToolPermissionRequest: onAsk },
      true,
    );

    expect(result.approved).toBe(true);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("keeps the headless refusal for a session without a grant", async () => {
    clearSessionApprovals();

    const result = await checkToolPermissionApproval(
      bashAskPolicies,
      bashCall("ls -la"),
      { onToolPermissionRequest: vi.fn() },
      true,
    );

    expect(result).toMatchObject({ approved: false, denialReason: "policy" });
  });

  it("still asks for a destructive command under full access", async () => {
    const onAsk = vi.fn();

    const pending = checkToolPermissionApproval(
      bashAskPolicies,
      bashCall("git reset --hard"),
      { onToolPermissionRequest: onAsk },
    );
    await flush();

    expect(onAsk).toHaveBeenCalledTimes(1);
    const requestId = toolPermissionManager.getPendingRequestIds().at(-1);
    expect(requestId).toBeDefined();
    toolPermissionManager.rejectRequest(requestId ?? "");

    await expect(pending).resolves.toMatchObject({
      approved: false,
      denialReason: "user",
    });
  });

  it("keeps asking in a different session", async () => {
    startNewSession();
    const onAsk = vi.fn();

    const pending = checkToolPermissionApproval(
      bashAskPolicies,
      bashCall("ls -la"),
      { onToolPermissionRequest: onAsk },
    );
    await flush();

    expect(onAsk).toHaveBeenCalledTimes(1);
    const requestId = toolPermissionManager.getPendingRequestIds().at(-1);
    toolPermissionManager.rejectRequest(requestId ?? "");

    await expect(pending).resolves.toMatchObject({
      approved: false,
      denialReason: "user",
    });
  });
});
