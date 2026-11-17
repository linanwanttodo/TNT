import { describe, expect, it } from "vitest";

import type { ChatMessage, Tool } from "../index.js";
import {
  buildCacheFingerprint,
  cacheBreakConversationKey,
  compareStoredCacheFingerprint,
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

describe("the per-conversation fingerprint store", () => {
  const tools = [tool("read_file", "read a file")];

  it("keys the conversation by the resolved model and its opening user message", () => {
    const otherOpener: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "a different opening question" },
    ];
    expect(cacheBreakConversationKey(SYSTEM, "gpt-4")).toBe(
      cacheBreakConversationKey(SYSTEM, "gpt-4"),
    );
    expect(cacheBreakConversationKey(SYSTEM, "gpt-4")).not.toBe(
      cacheBreakConversationKey(SYSTEM, "gpt-4o"),
    );
    expect(cacheBreakConversationKey(SYSTEM, "gpt-4")).not.toBe(
      cacheBreakConversationKey(otherOpener, "gpt-4"),
    );
  });

  it("keeps conversations of the same model from reporting each other's changes", () => {
    const otherOpener: ChatMessage[] = [
      { role: "system", content: "Other instructions." },
      { role: "user", content: "a different opening question" },
    ];
    const firstKey = cacheBreakConversationKey(SYSTEM, "gpt-4");
    const secondKey = cacheBreakConversationKey(otherOpener, "gpt-4");

    expect(
      compareStoredCacheFingerprint(
        firstKey,
        buildCacheFingerprint(SYSTEM, tools, "gpt-4"),
      ),
    ).toBeNull();
    // Conversation B has a different system prompt; under a shared per-model
    // key this would have reported a phantom system_prompt break.
    expect(
      compareStoredCacheFingerprint(
        secondKey,
        buildCacheFingerprint(otherOpener, tools, "gpt-4"),
      ),
    ).toBeNull();
    // Conversation A continues with changed tools: a real break, reported.
    expect(
      compareStoredCacheFingerprint(
        firstKey,
        buildCacheFingerprint(SYSTEM, [tool("grep", "search")], "gpt-4"),
      ),
    ).toEqual({ reason: "tools", changedTools: ["grep"] });
  });

  it("evicts the oldest conversation once the store is full", () => {
    const fingerprint = buildCacheFingerprint(SYSTEM, tools, "gpt-4");
    // 200 > the 64-entry limit plus anything earlier tests stored, so every
    // key below the last 64 inserts is guaranteed to be evicted.
    for (let i = 0; i < 200; i++) {
      compareStoredCacheFingerprint(`model:${i}`, fingerprint);
    }
    // Key "model:0" was evicted: re-recording it has nothing to compare
    // against, so a changed fingerprint reports nothing.
    const changed = buildCacheFingerprint(
      SYSTEM,
      [tool("grep", "search")],
      "gpt-4",
    );
    expect(compareStoredCacheFingerprint("model:0", changed)).toBeNull();
    // A key that is still stored keeps detecting the change.
    expect(compareStoredCacheFingerprint("model:199", changed)).toEqual({
      reason: "tools",
      changedTools: ["grep"],
    });
  });
});
