import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { describe, expect, it } from "vitest";

import {
  applyCacheControlFormat,
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

describe("applyCacheControlFormat", () => {
  const ephemeral = { type: "ephemeral" as const };
  const body = () => ({
    system: [{ type: "text" as const, text: "s", cache_control: ephemeral }],
    tools: [{ name: "Read", cache_control: ephemeral }],
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "m", cache_control: ephemeral },
        ],
      },
    ],
  });

  it("changes nothing when no capabilities are declared", () => {
    const input = body();
    expect(applyCacheControlFormat(input, undefined)).toBe(input);
    expect(applyCacheControlFormat(input, {})).toEqual(input);
  });

  it("drops tool breakpoints only when the endpoint rejects them", () => {
    const result = applyCacheControlFormat(body(), {
      acceptsCacheControlOnTools: false,
    });
    expect(result.tools[0]).not.toHaveProperty("cache_control");
    expect(result.messages[0].content[0]).toHaveProperty("cache_control");
    expect(result.system[0]).toHaveProperty("cache_control");
  });

  it("drops message breakpoints only when the endpoint rejects them", () => {
    const result = applyCacheControlFormat(body(), {
      acceptsCacheControlOnMessages: false,
    });
    expect(result.messages[0].content[0]).not.toHaveProperty("cache_control");
    expect(result.tools[0]).toHaveProperty("cache_control");
  });

  it("enforces one budget across system, tools and messages", () => {
    const result = applyCacheControlFormat(body(), { maxBreakpoints: 1 });
    // The budget goes to the breakpoint with the longest span ahead of it,
    // which is the one nearest the end of the request.
    expect(result.messages[0].content[0]).toHaveProperty("cache_control");
    expect(result.tools[0]).not.toHaveProperty("cache_control");
    expect(result.system[0]).not.toHaveProperty("cache_control");
  });

  it("keeps the most recent breakpoints when narrowing a budget", () => {
    const result = applyCacheControlFormat(body(), { maxBreakpoints: 1 });
    const kept =
      (result.messages[0].content[0] as any)?.cache_control ??
      (result.tools[0] as any)?.cache_control ??
      (result.system[0] as any)?.cache_control;
    expect(kept).toEqual(ephemeral);
  });

  it("removes every breakpoint when the budget is zero", () => {
    const result = applyCacheControlFormat(body(), { maxBreakpoints: 0 });
    expect(countCacheBreakpoints(result.messages)).toBe(0);
    expect((result.tools[0] as any).cache_control).toBeUndefined();
    expect((result.system[0] as any).cache_control).toBeUndefined();
  });
});
