import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolCall } from "../tools/types.js";
import { processToolCallDelta } from "./chunkProcessing.js";

/** Feeds one tool call's argument fragments the way a stream delivers them. */
function feed(fragments: string[]): ToolCall {
  const toolCalls = new Map<string, ToolCall>();
  const indexToId = new Map<number, string>();
  fragments.forEach((argumentsText, position) => {
    processToolCallDelta(
      {
        index: 0,
        id: position === 0 ? "call_1" : undefined,
        function: {
          name: position === 0 ? "Write" : undefined,
          arguments: argumentsText,
        },
      },
      toolCalls,
      indexToId,
    );
  });
  const call = toolCalls.get("call_1");
  if (!call) throw new Error("the tool call entry was never created");
  return call;
}

afterEach(() => vi.restoreAllMocks());

describe("streamed tool arguments", () => {
  it("parses the accumulated arguments once, when they close", () => {
    const parse = vi.spyOn(JSON, "parse");
    const call = feed(['{"file_path":', '"', "/tmp/a.txt", '"}']);

    expect(call.arguments).toEqual({ file_path: "/tmp/a.txt" });
    const attempts = parse.mock.calls.filter(
      ([text]) => typeof text === "string" && text.startsWith('{"file_path"'),
    );
    // One attempt per fragment would re-parse a growing buffer, and most of
    // those attempts throw because the JSON is not complete yet.
    expect(attempts).toHaveLength(1);
  });

  it("keeps braces inside a string value out of the structure", () => {
    // The value holds an unbalanced `{`: counting it as nesting means the
    // scan never returns to zero, so the call would end with no arguments.
    const call = feed(['{"pattern":"echo ', "a{", '"}']);
    expect(call.arguments).toEqual({ pattern: "echo a{" });
  });

  it("parses a single complete fragment", () => {
    const call = feed(['{"limit":10}']);
    expect(call.arguments).toEqual({ limit: 10 });
  });
});
