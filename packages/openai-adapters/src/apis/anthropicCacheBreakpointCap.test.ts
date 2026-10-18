import type { MessageCreateParams } from "@anthropic-ai/sdk/resources";
import { describe, expect, it } from "vitest";

import { addCacheControlToLastTwoUserMessages } from "./AnthropicUtils.js";
import { CACHING_STRATEGIES } from "./AnthropicCachingStrategies.js";
import { ANTHROPIC_BREAKPOINTS_KEPT } from "./cacheControl.js";
import { applyAnthropicCachingToOpenRouterBody } from "./OpenRouterCaching.js";

/**
 * Anthropic takes at most four `cache_control` breakpoints per request, and the
 * budget is shared by the system blocks, the tool list and the messages: a fifth
 * marker is a 400, not a marker the provider quietly ignores. Nothing in this
 * package counted what the strategies add together, so a request whose system
 * arrived as several blocks asked for six.
 *
 * The cases count the finished body instead of trusting what each helper meant to
 * do. `model` and `max_tokens` fill the two fields no strategy reads.
 */
const ANTHROPIC_MAX_BREAKPOINTS = 4;

type Body = {
  model: string;
  max_tokens: number;
  system?: any[];
  tools?: any[];
  messages: any[];
};

function makeBody(parts: Partial<Body>): Body {
  return {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [],
    ...parts,
  };
}

function applyStrategy(name: string, body: Body): Body {
  const strategy = (CACHING_STRATEGIES as Record<string, any>)[name];
  return strategy(body as unknown as MessageCreateParams) as Body;
}

function countBreakpoints(body: Body): number {
  let total = 0;
  total += (body.system ?? []).filter((block) => block?.cache_control).length;
  total += (body.tools ?? []).filter((tool) => tool?.cache_control).length;
  for (const message of body.messages) {
    if (Array.isArray(message.content)) {
      total += message.content.filter(
        (block: any) => block?.cache_control,
      ).length;
    }
  }
  return total;
}

function turns(count: number, chars = 30): any[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `turn ${index} ${"x".repeat(chars)}` }],
  }));
}

function systemBlocks(count: number): any[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "text",
    text: `system block ${index}`,
  }));
}

function tools(count: number): any[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${index}`,
    description: "does something",
    input_schema: { type: "object", properties: {} },
  }));
}

describe("the cache breakpoint cap on an Anthropic request body", () => {
  it("uses the whole budget of four when the system is one block and tools exist", () => {
    const result = applyStrategy(
      "systemAndTools",
      makeBody({
        system: systemBlocks(1),
        tools: tools(3),
        messages: turns(6),
      }),
    );

    // system 1 + the last tool 1 + the two newest user turns: the four the
    // provider allows, which is what the shipped shape is meant to look like.
    expect(countBreakpoints(result)).toBe(ANTHROPIC_MAX_BREAKPOINTS);
  });

  it("stays inside the cap when the system arrives as several blocks", () => {
    const result = applyStrategy(
      "systemAndTools",
      makeBody({
        system: systemBlocks(4),
        tools: tools(2),
        messages: turns(5),
      }),
    );

    // Four system blocks alone consume the budget. Before the trailing-turn
    // placement was told what was left, this body asked for six.
    expect(countBreakpoints(result)).toBeLessThanOrEqual(
      ANTHROPIC_MAX_BREAKPOINTS,
    );
  });

  it("is idempotent, because a strategy and a later caller both place markers", () => {
    const body = applyStrategy(
      "systemAndTools",
      makeBody({
        system: systemBlocks(1),
        tools: tools(2),
        messages: turns(6),
      }),
    );
    const afterStrategy = countBreakpoints(body);

    addCacheControlToLastTwoUserMessages(body.messages);
    addCacheControlToLastTwoUserMessages(body.messages);

    expect(countBreakpoints(body)).toBe(afterStrategy);
  });

  it("keeps every strategy inside the cap on one over-budget body", () => {
    const hostile = makeBody({
      system: systemBlocks(5),
      tools: tools(4),
      messages: turns(8, 900),
    });

    for (const name of Object.keys(CACHING_STRATEGIES)) {
      expect(
        countBreakpoints(applyStrategy(name, structuredClone(hostile))),
      ).toBeLessThanOrEqual(ANTHROPIC_MAX_BREAKPOINTS);
    }
  });

  it("skips a turn that cannot carry a marker instead of wasting the budget", () => {
    const body = makeBody({
      messages: [
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        { role: "user", content: [{ type: "text", text: "second" }] },
        // The newest user turn has no text block, so it is not a candidate: the
        // old loop spent an allowance on it and cached nothing there.
        { role: "user", content: [{ type: "image", source: {} }] },
      ],
    });

    addCacheControlToLastTwoUserMessages(body.messages);

    expect(countBreakpoints(body)).toBe(2);
  });

  it("does not hand the OpenRouter path a sixth marker when the strategy only marks the system", () => {
    // Four separate system messages become four system blocks, which is the whole
    // budget under `systemOnly`. The mirror step then copies markers back onto the
    // OpenAI-shaped parts, so any extra the messages top-up adds is a fifth or
    // sixth breakpoint on the request that actually goes out.
    const openaiBody: any = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        { role: "system", content: "first system block" },
        { role: "system", content: "second system block" },
        { role: "system", content: "third system block" },
        { role: "system", content: "fourth system block" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "again" },
      ],
    };

    applyAnthropicCachingToOpenRouterBody(openaiBody, "systemOnly");

    const markers = openaiBody.messages.reduce(
      (total: number, message: any) =>
        total +
        (Array.isArray(message.content)
          ? message.content.filter((part: any) => part?.cache_control).length
          : 0),
      0,
    );
    expect(markers).toBeGreaterThan(0);
    expect(markers).toBeLessThanOrEqual(ANTHROPIC_MAX_BREAKPOINTS);
  });
});

/**
 * Two is the number this project sends: the newest message, whose span reaches
 * back over everything before it, plus one on the stable head. Each extra marker
 * bills a cache write at about 1.25x for a span a kept one already covers, which
 * is why the direct Anthropic route narrows its finished body with
 * `capBreakpointsForAnthropic` before sending.
 *
 * The OpenRouter route mirrors the Anthropic-shaped body back onto OpenAI-shaped
 * parts and had no such narrowing, so the only thing limiting it was the four
 * breakpoint provider ceiling - a body could go out with twice the policy, and
 * with the system block instead of the newest turn marked when the strategy spent
 * its allowance on the head.
 */
describe("the OpenRouter route keeps to the two-breakpoint policy", () => {
  function markersOnOpenAiBody(openaiBody: any): number {
    let total = 0;
    for (const message of openaiBody.messages ?? []) {
      if (Array.isArray(message.content)) {
        total += message.content.filter(
          (part: any) => part?.cache_control,
        ).length;
      }
    }
    total += (openaiBody.tools ?? []).filter(
      (tool: any) => tool?.cache_control,
    ).length;
    return total;
  }

  function openAiRequest(withTools: boolean): any {
    return {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        { role: "system", content: "the stable head" },
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "second" },
      ],
      ...(withTools
        ? {
            tools: [
              {
                type: "function",
                function: { name: "Read", parameters: {} },
              },
              {
                type: "function",
                function: { name: "Search", parameters: {} },
              },
            ],
          }
        : {}),
    };
  }

  it("sends no more than the policy with the default strategy", () => {
    const body = openAiRequest(true);
    applyAnthropicCachingToOpenRouterBody(body, "systemAndTools");

    // Floor: the route has to place something, or "at most two" would be
    // satisfied by a request that caches nothing at all.
    expect(markersOnOpenAiBody(body)).toBeGreaterThan(0);
    expect(markersOnOpenAiBody(body)).toBeLessThanOrEqual(
      ANTHROPIC_BREAKPOINTS_KEPT,
    );
  });

  it("keeps the newest turn marked rather than spending the policy on the head", () => {
    const body = openAiRequest(true);
    applyAnthropicCachingToOpenRouterBody(body, "systemAndTools");

    const newestUser = [...body.messages]
      .reverse()
      .find(
        (message: any) =>
          message.role === "user" && Array.isArray(message.content),
      );
    expect(newestUser.content.some((part: any) => part?.cache_control)).toBe(
      true,
    );
  });
});
