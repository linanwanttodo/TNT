import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HookEventResult } from "../hooks/types.js";
import { readFileTool } from "../tools/readFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";

import { executeStreamedToolCalls } from "./streamChatResponse.helpers.js";

const empty = (): Partial<HookEventResult> => ({ blocked: false, results: [] });

const fireHooks = vi.hoisted(() => ({
  firePreToolUse: vi.fn(async (..._args: unknown[]) => empty()),
  firePostToolUse: vi.fn(async (..._args: unknown[]) => empty()),
  firePostToolUseFailure: vi.fn(async (..._args: unknown[]) => empty()),
}));
vi.mock("../hooks/fireHook.js", () => ({
  firePreToolUse: (...args: unknown[]) => fireHooks.firePreToolUse(...args),
  firePostToolUse: (...args: unknown[]) => fireHooks.firePostToolUse(...args),
  firePostToolUseFailure: (...args: unknown[]) =>
    fireHooks.firePostToolUseFailure(...args),
  firePermissionRequest: vi.fn(async () => empty()),
}));

const allowAll = { policies: [{ tool: "*", permission: "allow" as const }] };

const call: PreprocessedToolCall = {
  id: "call_1",
  name: "Read",
  arguments: { filepath: "/x.txt" },
  argumentsStr: '{"filepath":"/x.txt"}',
  startNotified: false,
  tool: readFileTool,
};

/**
 * PreToolUse and PostToolUse both publish `additionalContext`, and the runner
 * aggregates it, but the loop read only `blocked`/`permissionDecision`/
 * `updatedInput` - so a hook's note to the model was parsed and thrown away.
 */
describe("hook additionalContext reaches the model", () => {
  beforeEach(() => {
    for (const mock of Object.values(fireHooks)) {
      mock.mockReset();
      mock.mockResolvedValue(empty());
    }
  });

  it("carries both hooks' context inside the tool result", async () => {
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi
      .spyOn(toolsModule, "executeToolCall")
      .mockResolvedValue("file body");
    fireHooks.firePreToolUse.mockResolvedValueOnce({
      ...empty(),
      additionalContext: "prefer the vendored copy",
    });
    fireHooks.firePostToolUse.mockResolvedValueOnce({
      ...empty(),
      additionalContext: "2 diagnostics after this edit",
    });

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [call],
      undefined,
      false,
      undefined,
      allowAll,
    );

    const content = String(chatHistoryEntries[0]?.content);
    expect(content).toContain("file body");
    expect(content).toContain(
      "<system-reminder>PreToolUse:Read hook additional context: prefer the vendored copy</system-reminder>",
    );
    expect(content).toContain(
      "<system-reminder>PostToolUse:Read hook additional context: 2 diagnostics after this edit</system-reminder>",
    );
    executeToolCall.mockRestore();
  });

  it("carries a failed call's context into the errored result", async () => {
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi
      .spyOn(toolsModule, "executeToolCall")
      .mockRejectedValue(new Error("disk full"));
    fireHooks.firePostToolUseFailure.mockResolvedValueOnce({
      ...empty(),
      additionalContext: "retry after the volume is expanded",
    });

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [call],
      undefined,
      false,
      undefined,
      allowAll,
    );

    expect(chatHistoryEntries[0]?.status).toBe("errored");
    const content = String(chatHistoryEntries[0]?.content);
    expect(content).toContain("disk full");
    expect(content).toContain(
      "<system-reminder>PostToolUseFailure:Read hook additional context: retry after the volume is expanded</system-reminder>",
    );
    executeToolCall.mockRestore();
  });

  it("leaves the result alone when no hook adds context", async () => {
    const toolsModule = await import("../tools/index.js");
    const executeToolCall = vi
      .spyOn(toolsModule, "executeToolCall")
      .mockResolvedValue("file body");

    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [call],
      undefined,
      false,
      undefined,
      allowAll,
    );

    expect(String(chatHistoryEntries[0]?.content)).toBe("file body");
    expect(chatHistoryEntries[0]?.content).not.toContain("system-reminder");
    executeToolCall.mockRestore();
  });
});
