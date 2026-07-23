import type { ChatHistoryItem } from "core/index.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  EVICTION_PLACEHOLDER,
  evictionTokenThreshold,
  evictOldToolResults,
} from "./toolOutputEviction.js";

const previousThreshold = process.env.TNT_TOOL_EVICTION_TOKENS;
const previousKeep = process.env.TNT_TOOL_EVICTION_KEEP;

afterEach(() => {
  if (previousThreshold === undefined) {
    delete process.env.TNT_TOOL_EVICTION_TOKENS;
  } else {
    process.env.TNT_TOOL_EVICTION_TOKENS = previousThreshold;
  }
  if (previousKeep === undefined) {
    delete process.env.TNT_TOOL_EVICTION_KEEP;
  } else {
    process.env.TNT_TOOL_EVICTION_KEEP = previousKeep;
  }
});

function user(text: string): ChatHistoryItem {
  return { message: { role: "user", content: text }, contextItems: [] };
}

function assistant(text: string): ChatHistoryItem {
  return { message: { role: "assistant", content: text }, contextItems: [] };
}

function toolResult(id: string, sizeChars: number): ChatHistoryItem {
  return {
    message: {
      role: "tool",
      toolCallId: id,
      content: "x".repeat(sizeChars),
    },
    contextItems: [],
  };
}

function historyWithTools(count: number, sizeChars: number): ChatHistoryItem[] {
  const items: ChatHistoryItem[] = [user("start")];
  for (let i = 0; i < count; i += 1) {
    items.push(assistant(`call ${i}`));
    items.push(toolResult(`call-${i}`, sizeChars));
  }
  return items;
}

describe("evictOldToolResults", () => {
  // The default gate is 100k tokens and history size estimates at chars/4, so
  // 8 results of 60k chars ≈ 120k tokens cross it.
  const SIZE = 60_000;

  it("leaves the history alone under the threshold", () => {
    const history = historyWithTools(2, 1_000);
    const result = evictOldToolResults({ history, contextWindow: 1_000_000 });
    expect(result.evicted).toBe(0);
    expect(result.history).toBe(history);
  });

  it("replaces older tool results with the placeholder past the threshold", () => {
    const history = historyWithTools(8, SIZE);
    const result = evictOldToolResults({
      history,
      contextWindow: 1_000_000,
      keepRecent: 5,
    });

    expect(result.evicted).toBe(3);
    const tools = result.history.filter((item) => item.message.role === "tool");
    // Newest five keep their bytes; the older three are placeholders.
    for (let i = 0; i < 3; i += 1) {
      expect(tools[i].message).toMatchObject({
        content: EVICTION_PLACEHOLDER,
        toolCallId: `call-${i}`,
      });
    }
    for (let i = 5; i < 8; i += 1) {
      expect(tools[i].message.role === "tool" && tools[i].message.content).toBe(
        "x".repeat(SIZE),
      );
    }
    // Non-tool messages pass through untouched.
    expect(result.history[0]).toBe(history[0]);
  });

  it("does not mutate the input history", () => {
    const history = historyWithTools(8, SIZE);
    evictOldToolResults({ history, contextWindow: 1_000_000, keepRecent: 5 });
    const first = history.find((item) => item.message.role === "tool");
    expect(first?.message.role === "tool" && first.message.content).not.toBe(
      EVICTION_PLACEHOLDER,
    );
  });

  it("is a no-op again once everything older than the newest N is evicted", () => {
    const history = historyWithTools(8, SIZE);
    const first = evictOldToolResults({
      history,
      contextWindow: 1_000_000,
      keepRecent: 5,
    });
    const second = evictOldToolResults({
      history: first.history,
      contextWindow: 1_000_000,
      keepRecent: 5,
    });
    expect(second.evicted).toBe(0);
    expect(second.history).toEqual(first.history);
  });

  it("keeps everything when there are fewer results than keepRecent", () => {
    const history = historyWithTools(3, SIZE);
    const result = evictOldToolResults({ history, contextWindow: 1_000_000 });
    expect(result.evicted).toBe(0);
    expect(result.history).toBe(history);
  });

  it("uses the provider's measurement over the char estimate", () => {
    const history = historyWithTools(8, 1_000);
    const result = evictOldToolResults({
      history,
      contextWindow: 1_000_000,
      measuredInputTokens: 500_000,
    });
    expect(result.evicted).toBe(3);
  });

  it("caps the absolute threshold at 40% of the window", () => {
    delete process.env.TNT_TOOL_EVICTION_TOKENS;
    expect(evictionTokenThreshold(200_000)).toBe(80_000);
    expect(evictionTokenThreshold(1_000_000)).toBe(100_000);
    process.env.TNT_TOOL_EVICTION_TOKENS = "40000";
    expect(evictionTokenThreshold(1_000_000)).toBe(40_000);
    // A small window keeps the ratio as the tighter bound.
    expect(evictionTokenThreshold(50_000)).toBe(20_000);
  });

  it("reads keepRecent from the environment", () => {
    process.env.TNT_TOOL_EVICTION_KEEP = "2";
    const history = historyWithTools(8, SIZE);
    const result = evictOldToolResults({ history, contextWindow: 1_000_000 });
    expect(result.evicted).toBe(6);
  });
});
