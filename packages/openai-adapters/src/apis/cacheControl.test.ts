import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { describe, expect, it } from "vitest";

import {
  countCacheBreakpoints,
  pruneCacheBreakpoints,
  sanitizeReasoningBlocks,
} from "./cacheControl.js";

describe("pruneCacheBreakpoints", () => {
  it("keeps the most recent breakpoints and drops the rest", () => {
    const items = [
      { id: 1, cache_control: { type: "ephemeral" } },
      { id: 2 },
      { id: 3, cache_control: { type: "ephemeral" } },
      { id: 4, cache_control: { type: "ephemeral" } },
    ];
    expect(pruneCacheBreakpoints(items, 2)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3, cache_control: { type: "ephemeral" } },
      { id: 4, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("leaves items untouched when under the limit", () => {
    const items = [{ id: 1, cache_control: { type: "ephemeral" } }];
    expect(pruneCacheBreakpoints(items, 4)).toEqual(items);
  });

  it("drops every breakpoint when the limit is zero", () => {
    const items = [{ id: 1, cache_control: { type: "ephemeral" } }];
    expect(pruneCacheBreakpoints(items, 0)).toEqual([{ id: 1 }]);
  });

  it("removes only the breakpoint, keeping sibling keys", () => {
    const items = [
      {
        id: 1,
        cache_control: { type: "ephemeral" },
        thinking: { type: "enabled", budget_tokens: 1024 },
      },
    ];
    expect(pruneCacheBreakpoints(items, 0)).toEqual([
      { id: 1, thinking: { type: "enabled", budget_tokens: 1024 } },
    ]);
  });

  it("preserves item order", () => {
    const items = [
      { id: 1, cache_control: { type: "ephemeral" } },
      { id: 2 },
      { id: 3, cache_control: { type: "ephemeral" } },
    ];
    expect(pruneCacheBreakpoints(items, 1).map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

describe("sanitizeReasoningBlocks", () => {
  it("removes a reasoning block that has no signature", () => {
    const messages: MessageParam[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm", signature: "sig" },
          { type: "thinking", thinking: "no sig" } as any,
          { type: "text", text: "answer" },
        ],
      },
    ];
    expect(sanitizeReasoningBlocks(messages)[0].content).toEqual([
      { type: "thinking", thinking: "hmm", signature: "sig" },
      { type: "text", text: "answer" },
    ]);
  });

  it("strips a breakpoint from a reasoning block", () => {
    const messages: MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "hmm",
            signature: "sig",
            cache_control: { type: "ephemeral" },
          } as any,
        ],
      },
    ];
    expect(sanitizeReasoningBlocks(messages)[0].content).toEqual([
      { type: "thinking", thinking: "hmm", signature: "sig" },
    ]);
  });

  it("keeps a redacted reasoning block that carries its data", () => {
    const messages: MessageParam[] = [
      {
        role: "assistant",
        content: [{ type: "redacted_thinking", data: "xyz" }],
      },
    ];
    expect(sanitizeReasoningBlocks(messages)[0].content).toEqual([
      { type: "redacted_thinking", data: "xyz" },
    ]);
  });

  it("drops a message left with no content", () => {
    const messages: MessageParam[] = [
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "x" } as any],
      },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    const result = sanitizeReasoningBlocks(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("leaves string content untouched", () => {
    const messages: MessageParam[] = [{ role: "user", content: "plain" }];
    expect(sanitizeReasoningBlocks(messages)).toEqual(messages);
  });
});

describe("countCacheBreakpoints", () => {
  it("counts breakpoints across messages", () => {
    const messages: MessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "a", cache_control: { type: "ephemeral" } },
          { type: "text", text: "b" },
        ],
      },
      { role: "user", content: "no blocks" },
    ];
    expect(countCacheBreakpoints(messages)).toBe(1);
  });
});
