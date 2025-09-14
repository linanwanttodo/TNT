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
 * A tail reminder has exactly one job: travel inside the tool result the
 * model reads next, after the cached prefix. This asserts the ride, not the
 * trigger logic (that lives in the tracker's own tests).
 */
describe("tail reminder riding a tool result", () => {
  beforeEach(async () => {
    for (const mock of Object.values(fireHooks)) {
      mock.mockReset();
      mock.mockResolvedValue(empty());
    }
    const toolsModule = await import("../tools/index.js");
    vi.spyOn(toolsModule, "executeToolCall").mockResolvedValue("file body");
  });

  it("appends the reminder to the result and passes the tool name in", async () => {
    const seen: string[] = [];
    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [call],
      {
        onTailReminder: (toolName) => {
          seen.push(toolName);
          return "keep the list truthful";
        },
      },
      false,
      undefined,
      allowAll,
    );

    expect(seen).toEqual(["Read"]);
    const content = String(chatHistoryEntries[0]?.content);
    expect(content).toContain("file body");
    expect(content).toContain("keep the list truthful");
    expect(content).toContain("<system-reminder>");
  });

  it("leaves the result untouched when nothing is due", async () => {
    const { chatHistoryEntries } = await executeStreamedToolCalls(
      [call],
      { onTailReminder: () => undefined },
      false,
      undefined,
      allowAll,
    );

    const content = String(chatHistoryEntries[0]?.content);
    expect(content).toBe("file body");
    expect(content).not.toContain("system-reminder");
  });
});
