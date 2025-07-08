import type { ChatHistoryItem } from "core/index.js";
import { describe, expect, it } from "vitest";

import { buildSummaryRequest, isPrefixReusable } from "./prefixPreservation.js";

function user(content: string): ChatHistoryItem {
  return { message: { role: "user", content }, contextItems: [] };
}

function assistant(content: string): ChatHistoryItem {
  return { message: { role: "assistant", content }, contextItems: [] };
}

describe("buildSummaryRequest", () => {
  it("replays the history unchanged and appends the instruction", () => {
    const history = [user("a"), assistant("b"), user("c")];
    const result = buildSummaryRequest(history, "summarize");

    expect(result.history).toHaveLength(4);
    expect(result.history.slice(0, 3)).toEqual(history);
    expect(result.history[3].message.content).toBe("summarize");
  });

  it("reports the reusable prefix length", () => {
    const history = [user("a"), assistant("b")];
    expect(buildSummaryRequest(history, "x").reusablePrefixLength).toBe(2);
  });

  it("keeps every earlier item byte-identical", () => {
    const history = [user("a"), assistant("b")];
    const result = buildSummaryRequest(history, "x");
    expect(isPrefixReusable(history, result.history)).toBe(true);
  });

  it("does not fold the history into a single message", () => {
    const history = [user("a"), assistant("b"), user("c")];
    const result = buildSummaryRequest(history, "summarize");
    // A folded request would carry one string message and lose the structure
    // the provider already has a cached prefix for.
    // Two original user turns, each still its own message, plus the
    // instruction. A folded request would collapse these into one.
    expect(
      result.history.filter((i) => i.message.role === "user"),
    ).toHaveLength(3);
  });

  it("handles an empty history", () => {
    const result = buildSummaryRequest([], "summarize");
    expect(result.history).toHaveLength(1);
    expect(result.reusablePrefixLength).toBe(0);
  });
});

describe("isPrefixReusable", () => {
  it("is true when the next request extends the previous one", () => {
    expect(isPrefixReusable([user("a")], [user("a"), assistant("b")])).toBe(
      true,
    );
  });

  it("is false when an earlier item changed", () => {
    expect(isPrefixReusable([user("a")], [user("z"), assistant("b")])).toBe(
      false,
    );
  });

  it("is false when the next request is shorter", () => {
    expect(isPrefixReusable([user("a"), assistant("b")], [user("a")])).toBe(
      false,
    );
  });

  it("is true for two identical histories", () => {
    const history = [user("a")];
    expect(isPrefixReusable(history, history)).toBe(true);
  });

  it("detects a change in context items, not just message content", () => {
    const before: ChatHistoryItem[] = [
      { message: { role: "user", content: "a" }, contextItems: [] },
    ];
    const after: ChatHistoryItem[] = [
      {
        message: { role: "user", content: "a" },
        contextItems: [
          {
            id: { providerTitle: "file", itemId: "ctx-1" },
            content: "file",
            name: "f",
            description: "d",
          },
        ],
      },
    ];
    expect(isPrefixReusable(before, after)).toBe(false);
  });
});
