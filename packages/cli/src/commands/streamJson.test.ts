import type { SessionUsage } from "core/index.js";

import {
  createStreamJsonCallbacks,
  streamJsonErrorLine,
  streamJsonResultLine,
} from "./streamJson.js";

function collect() {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => lines.push(line),
  };
}

const usage: SessionUsage = {
  promptTokens: 120,
  completionTokens: 40,
  totalCost: 0.0125,
  unpricedRequests: 2,
};

describe("createStreamJsonCallbacks", () => {
  it("renders completed content as one assistant line", () => {
    const { lines, write } = collect();
    createStreamJsonCallbacks(write).onContentComplete?.("hello");

    expect(lines).toEqual(['{"type":"assistant","content":"hello"}\n']);
  });

  it("keeps content with newlines on a single line", () => {
    const { lines, write } = collect();
    createStreamJsonCallbacks(write).onContentComplete?.("first\nsecond");

    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith("\n")).toBe(true);
    expect(JSON.parse(lines[0]).content).toBe("first\nsecond");
  });

  it("renders tool start with its name and arguments", () => {
    const { lines, write } = collect();
    createStreamJsonCallbacks(write).onToolStart?.("Read", {
      file_path: "a.ts",
    });

    expect(JSON.parse(lines[0])).toEqual({
      type: "tool-start",
      tool: "Read",
      arguments: { file_path: "a.ts" },
    });
  });

  it("renders tool results with the status the stream reported", () => {
    const { lines, write } = collect();
    createStreamJsonCallbacks(write).onToolResult?.(
      "file body",
      "Read",
      "done",
    );

    expect(JSON.parse(lines[0])).toEqual({
      type: "tool-result",
      tool: "Read",
      status: "done",
      result: "file body",
    });
  });

  it("renders a tool error without inventing a tool name", () => {
    const { lines, write } = collect();
    createStreamJsonCallbacks(write).onToolError?.("permission denied");

    const event = JSON.parse(lines[0]);
    expect(event.type).toBe("tool-error");
    expect(event.error).toBe("permission denied");
    expect("tool" in event).toBe(false);
  });

  it("renders turn end with the reason and the notice when there is one", () => {
    const { lines, write } = collect();
    const callbacks = createStreamJsonCallbacks(write);
    callbacks.onTurnTerminated?.("max_steps", { notice: "cut short" });

    expect(JSON.parse(lines[0])).toEqual({
      type: "turn-end",
      reason: "max_steps",
      notice: "cut short",
    });
  });

  it("omits the notice key on a clean turn end", () => {
    const { lines, write } = collect();
    createStreamJsonCallbacks(write).onTurnTerminated?.("no_tool_calls");

    const event = JSON.parse(lines[0]);
    expect(event.reason).toBe("no_tool_calls");
    expect("notice" in event).toBe(false);
  });
});

describe("streamJsonResultLine", () => {
  it("carries the final content and the session usage", () => {
    const line = streamJsonResultLine("the answer", usage);

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: "result",
      subtype: "success",
      content: "the answer",
      usage,
    });
  });

  it("reports a failed run as a result line with the error", () => {
    const line = streamJsonErrorLine("no models were found");

    expect(JSON.parse(line)).toEqual({
      type: "result",
      subtype: "error",
      error: "no models were found",
    });
  });
});
