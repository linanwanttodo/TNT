import { describe, expect, it, vi } from "vitest";

import type { PreprocessedToolCall, Tool } from "./types.js";

import { executeToolCall } from "./index.js";

/** A tool that records the context it was handed, and does nothing else. */
function fakeTool() {
  const contexts: unknown[] = [];
  const tool: Tool = {
    name: "Fake",
    displayName: "Fake",
    description: "records its run context",
    parameters: { type: "object", properties: {} } as Tool["parameters"],
    isBuiltIn: true,
    run: vi.fn(async (_args: unknown, context: unknown) => {
      contexts.push(context);
      return "ran";
    }),
  };
  const call = {
    id: "call-1",
    name: "Fake",
    arguments: {},
    tool,
  } as unknown as PreprocessedToolCall;
  return { call, tool, contexts };
}

describe("executeToolCall and the run signal", () => {
  it("reports a call the run gave up on before it started", async () => {
    const { call, tool } = fakeTool();
    const controller = new AbortController();
    controller.abort();

    const result = await executeToolCall(call, {
      parallelToolCallCount: 1,
      signal: controller.signal,
    });

    // Starting work whose result nothing will read is what the deadline is
    // meant to prevent, so the tool must not run at all.
    expect(tool.run).not.toHaveBeenCalled();
    expect(String(result)).toContain("Not executed");
  });
});
