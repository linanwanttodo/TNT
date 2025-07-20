import { describe, expect, it } from "vitest";

import type { ChatMessage, Tool } from "../index.js";
import {
  buildCacheFingerprint,
  detectCacheBreak,
  hashString,
} from "./cacheBreakDetection.js";

function tool(name: string, description: string): Tool {
  return {
    type: "function",
    displayTitle: name,
    readonly: true,
    group: "test",
    function: {
      name,
      description,
      parameters: { type: "object", properties: {} },
    },
  };
}

const SYSTEM: ChatMessage[] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "hello" },
];

describe("hashString", () => {
  it("is stable and sensitive to content", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});

describe("buildCacheFingerprint", () => {
  it("ignores the user messages that change every turn", () => {
    const tools = [tool("read_file", "read a file")];
    const first = buildCacheFingerprint(SYSTEM, tools, "gpt-4");
    const second = buildCacheFingerprint(
      [...SYSTEM, { role: "user", content: "a new question" }],
      tools,
      "gpt-4",
    );

    expect(second.systemHash).toBe(first.systemHash);
    expect(second.toolsHash).toBe(first.toolsHash);
  });
});

describe("detectCacheBreak", () => {
  const tools = [tool("read_file", "read a file")];

  it("reports no break when nothing changed", () => {
    const previous = buildCacheFingerprint(SYSTEM, tools, "gpt-4");
    const current = buildCacheFingerprint(SYSTEM, tools, "gpt-4");
    expect(detectCacheBreak(previous, current)).toBeNull();
  });

  it("has nothing to compare against on the first request", () => {
    const current = buildCacheFingerprint(SYSTEM, tools, "gpt-4");
    expect(detectCacheBreak(undefined, current)).toBeNull();
  });

  it("detects a system prompt change", () => {
    const previous = buildCacheFingerprint(SYSTEM, tools, "gpt-4");
    const current = buildCacheFingerprint(
      [{ role: "system", content: "Different instructions." }],
      tools,
      "gpt-4",
    );
    expect(detectCacheBreak(previous, current)).toEqual({
      reason: "system_prompt",
    });
  });

  it("detects a model change", () => {
    const previous = buildCacheFingerprint(SYSTEM, tools, "gpt-4");
    const current = buildCacheFingerprint(SYSTEM, tools, "gpt-4o");
    expect(detectCacheBreak(previous, current)).toEqual({ reason: "model" });
  });

  it("names the tool whose definition changed", () => {
    const previous = buildCacheFingerprint(
      SYSTEM,
      [tool("read_file", "read a file"), tool("grep", "search files")],
      "gpt-4",
    );
    const current = buildCacheFingerprint(
      SYSTEM,
      [tool("read_file", "read a file"), tool("grep", "search many files")],
      "gpt-4",
    );

    expect(detectCacheBreak(previous, current)).toEqual({
      reason: "tools",
      changedTools: ["grep"],
    });
  });

  it("detects a tool added or removed", () => {
    const previous = buildCacheFingerprint(
      SYSTEM,
      [tool("read_file", "x")],
      "gpt-4",
    );
    const current = buildCacheFingerprint(
      SYSTEM,
      [tool("read_file", "x"), tool("grep", "y")],
      "gpt-4",
    );
    expect(detectCacheBreak(previous, current)?.reason).toBe("tools");
  });
});
