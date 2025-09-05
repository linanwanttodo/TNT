import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toolPermissionManager } from "../permissions/permissionManager.js";
import {
  clearSessionApprovals,
  rememberSessionApproval,
} from "../permissions/sessionApprovals.js";
import { runTerminalCommandTool } from "../tools/runTerminalCommand.js";
import type { PreprocessedToolCall } from "../tools/types.js";
import { writeFileTool } from "../tools/writeFile.js";

import { checkToolPermissionApproval } from "./streamChatResponse.helpers.js";

vi.mock("../hooks/fireHook.js", () => ({
  firePreToolUse: vi.fn(async () => ({ blocked: false, results: [] })),
  firePostToolUse: vi.fn(async () => ({ blocked: false, results: [] })),
  firePostToolUseFailure: vi.fn(async () => ({ blocked: false, results: [] })),
  firePermissionRequest: vi.fn(async () => ({ blocked: false, results: [] })),
  fireNotification: vi.fn(async () => ({ blocked: false, results: [] })),
}));

const askAll = { policies: [{ tool: "*", permission: "ask" as const }] };

function call(
  name: string,
  args: Record<string, unknown>,
  tool: PreprocessedToolCall["tool"],
): PreprocessedToolCall {
  return {
    id: "call_1",
    name,
    arguments: args,
    argumentsStr: JSON.stringify(args),
    startNotified: false,
    tool,
  };
}

const writeCall = (filepath: string) =>
  call("Write", { filepath, content: "x" }, writeFileTool);
const bashCall = (command: string) =>
  call("Bash", { command }, runTerminalCommandTool);

/**
 * The middle answer between "once" and "always": the human replies one time and
 * this exact call is not asked again for the rest of the session, with nothing
 * written to permissions.yaml. What it must not do is widen - a grant for one
 * command line or one file has to leave the next one asking.
 */
describe("a session approval in front of the prompt", () => {
  let prompts: ReturnType<typeof vi.fn>;
  let callbacks: { onToolPermissionRequest: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clearSessionApprovals();
    // The UI answers as soon as it is asked, so the promise under test settles.
    prompts = vi.fn((_name: string, _args: unknown, requestId: string) => {
      toolPermissionManager.approveRequest(requestId);
    });
    callbacks = { onToolPermissionRequest: prompts };
  });

  afterEach(() => {
    clearSessionApprovals();
  });

  it("asks when nothing has been approved yet", async () => {
    const result = await checkToolPermissionApproval(
      askAll,
      writeCall("src/a.ts"),
      callbacks,
      false,
    );

    expect(result.approved).toBe(true);
    expect(prompts).toHaveBeenCalledTimes(1);
  });

  it("does not ask again for the file that was approved", async () => {
    const key = rememberSessionApproval("Write", { filepath: "src/a.ts" });

    const result = await checkToolPermissionApproval(
      askAll,
      writeCall("src/a.ts"),
      callbacks,
      false,
    );

    expect(key).toContain("Write(");
    expect(result.approved).toBe(true);
    expect(prompts).not.toHaveBeenCalled();
  });

  it("still asks for the next file, which is the whole point of scoping it", async () => {
    rememberSessionApproval("Write", { filepath: "src/a.ts" });

    await checkToolPermissionApproval(
      askAll,
      writeCall("src/b.ts"),
      callbacks,
      false,
    );

    expect(prompts).toHaveBeenCalledTimes(1);
  });

  it("holds a shell approval only for the line the user read", async () => {
    rememberSessionApproval("Bash", { command: "npm run build" });

    await checkToolPermissionApproval(
      askAll,
      bashCall("npm run build"),
      callbacks,
      false,
    );
    expect(prompts).not.toHaveBeenCalled();

    await checkToolPermissionApproval(
      askAll,
      bashCall("npm run build && rm -rf dist"),
      callbacks,
      false,
    );
    expect(prompts).toHaveBeenCalledTimes(1);
  });

  it("never holds an MCP approval, because its arguments are not ours to bound", async () => {
    expect(
      rememberSessionApproval("mcp__github__create_issue", { title: "x" }),
    ).toBeUndefined();

    await checkToolPermissionApproval(
      askAll,
      call("mcp__github__create_issue", { title: "x" }, writeFileTool),
      callbacks,
      false,
    );

    expect(prompts).toHaveBeenCalledTimes(1);
  });

  it("lets a security hook veto even a call the session already covers", async () => {
    rememberSessionApproval("Write", { filepath: "src/a.ts" });
    const { firePermissionRequest } = await import("../hooks/fireHook.js");
    vi.mocked(firePermissionRequest).mockResolvedValueOnce({
      blocked: true,
      results: [],
    });

    const result = await checkToolPermissionApproval(
      askAll,
      writeCall("src/a.ts"),
      callbacks,
      false,
    );

    expect(result).toEqual({ approved: false, denialReason: "policy" });
  });
});
