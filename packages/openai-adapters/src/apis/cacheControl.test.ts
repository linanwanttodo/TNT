import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_MAX_CACHE_BREAKPOINTS,
  applyCacheControlFormat,
  capBreakpointsForAnthropic,
  countCacheBreakpoints,
  sanitizeReasoningBlocks,
} from "./cacheControl.js";

const marked = { type: "ephemeral" };

describe("capBreakpointsForAnthropic", () => {
  it("keeps the stable head and the newest message, and strips what is between", () => {
    const body = {
      system: [{ type: "text", text: "prompt", cache_control: marked }],
      tools: [
        { name: "Read", cache_control: marked },
        { name: "Bash" },
        { name: "Search", cache_control: marked },
      ],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "old", cache_control: marked }],
        },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        {
          role: "user",
          content: [{ type: "text", text: "new", cache_control: marked }],
        },
      ],
    };

    const capped = capBreakpointsForAnthropic(body, 2) as any;

    // The last tool is the better head than the system block because a
    // breakpoint there covers the system and every earlier tool too.
    expect((capped.tools?.[2] as any).cache_control).toEqual(marked);
    expect(capped.messages?.[2].content[0].cache_control).toEqual(marked);
    expect(capped.system?.[0]).not.toHaveProperty("cache_control");
    expect(capped.tools?.[0]).not.toHaveProperty("cache_control");
    expect(capped.messages?.[0].content[0]).not.toHaveProperty("cache_control");
  });

  it("counts the budget across the sections, not per section", () => {
    const four = {
      system: [{ type: "text", text: "a", cache_control: marked }],
      tools: [{ name: "Read", cache_control: marked }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "b", cache_control: marked }],
        },
        {
          role: "user",
          content: [{ type: "text", text: "c", cache_control: marked }],
        },
      ],
    };

    const capped = capBreakpointsForAnthropic(
      four,
      ANTHROPIC_MAX_CACHE_BREAKPOINTS,
    );
    const remaining =
      countCacheBreakpoints((capped as any).messages) +
      (capped as any).system.filter((b: any) => b.cache_control).length +
      (capped as any).tools.filter((t: any) => t.cache_control).length;

    expect(remaining).toBeLessThanOrEqual(ANTHROPIC_MAX_CACHE_BREAKPOINTS);
  });

  it("falls back to the system block when there are no tool breakpoints", () => {
    const capped = capBreakpointsForAnthropic(
      {
        system: [{ type: "text", text: "prompt", cache_control: marked }],
        tools: [{ name: "Read" }],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "x", cache_control: marked }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "y", cache_control: marked }],
          },
        ],
      },
      2,
    ) as any;

    expect(capped.system[0].cache_control).toEqual(marked);
    expect(capped.messages[1].content[0].cache_control).toEqual(marked);
    expect(capped.messages[0].content[0]).not.toHaveProperty("cache_control");
  });

  it("leaves a request alone when it is already within the budget", () => {
    const body = {
      tools: [{ name: "Read", cache_control: marked }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "x", cache_control: marked }],
        },
      ],
    };

    expect(capBreakpointsForAnthropic(body, 2)).toEqual(body);
  });

  it("strips every breakpoint when the budget is zero, keeping sibling keys", () => {
    const capped = capBreakpointsForAnthropic(
      {
        tools: [
          {
            name: "Read",
            cache_control: marked,
            thinking: { type: "enabled", budget_tokens: 1024 },
          },
        ],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "x", cache_control: marked }],
          },
        ],
      },
      0,
    ) as any;

    expect(capped.tools[0]).toEqual({
      name: "Read",
      thinking: { type: "enabled", budget_tokens: 1024 },
    });
    expect(capped.messages[0].content[0]).not.toHaveProperty("cache_control");
  });

  it("keeps the order and the untouched items exactly as they were", () => {
    const capped = capBreakpointsForAnthropic(
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "1", cache_control: marked }],
          },
          { role: "assistant", content: [{ type: "text", text: "2" }] },
          {
            role: "user",
            content: [{ type: "text", text: "3", cache_control: marked }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "4", cache_control: marked }],
          },
        ],
      },
      2,
    ) as any;

    expect(capped.messages.map((m: any) => m.content[0].text)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(capped.messages[1].content[0].text).toBe("2");
  });

  it("keeps only the newest message when the budget is one", () => {
    const capped = capBreakpointsForAnthropic(
      {
        system: [{ type: "text", text: "prompt", cache_control: marked }],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "x", cache_control: marked }],
          },
        ],
      },
      1,
    ) as any;

    expect(capped.messages[0].content[0].cache_control).toEqual(marked);
    expect(capped.system[0]).not.toHaveProperty("cache_control");
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
