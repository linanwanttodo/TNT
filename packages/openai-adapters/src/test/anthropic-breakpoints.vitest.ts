import type { ChatCompletionCreateParams } from "openai/resources/index.js";
import { describe, expect, it } from "vitest";

import { AnthropicApi } from "../apis/Anthropic.js";

function countBreakpoints(body: any): number {
  const inBlocks = (items: any[] | undefined) =>
    (items ?? []).reduce(
      (total, item) =>
        total +
        (item?.cache_control ? 1 : 0) +
        (Array.isArray(item?.content)
          ? item.content.filter((block: any) => block?.cache_control).length
          : 0),
      0,
    );
  return inBlocks(body.system) + inBlocks(body.tools) + inBlocks(body.messages);
}

function requestWithStableHeadAndTwoTurns(): ChatCompletionCreateParams {
  return {
    model: "claude-sonnet-4-5",
    messages: [
      { role: "system", content: "the standing instructions for this session" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "Read",
          description: "read a file",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    stream: false,
  } as unknown as ChatCompletionCreateParams;
}

function bodyFor(apiBase: string, model?: string): any {
  const api = new AnthropicApi({
    apiKey: "test-key",
    provider: "anthropic",
    apiBase,
    model,
  } as any);
  const body = requestWithStableHeadAndTwoTurns();
  if (model) body.model = model;
  return (api as any)._convertBody(body);
}

/**
 * What Anthropic bills per breakpoint, and what DeepSeek ignores, is decided at
 * the boundary between these two adapters and the request body, so the assertion
 * belongs here rather than on the helper alone.
 */
describe("the breakpoints an Anthropic-shaped request leaves with", () => {
  it("keeps at most two, whatever the strategy marked", () => {
    const body = bodyFor("https://api.anthropic.com/v1/");

    expect(countBreakpoints(body)).toBeLessThanOrEqual(2);
    expect(countBreakpoints(body)).toBeGreaterThan(0);
  });

  it("keeps the newest turn, because that span reaches back over everything", () => {
    const body = bodyFor("https://api.anthropic.com/v1/");
    const last = body.messages[body.messages.length - 1];

    expect(last.content.some((block: any) => block?.cache_control)).toBe(true);
  });

  it("marks nothing for a DeepSeek endpoint, which reads no breakpoint", () => {
    const body = bodyFor("https://api.deepseek.com/anthropic");

    expect(countBreakpoints(body)).toBe(0);
    expect(JSON.stringify(body)).not.toContain("cache_control");
  });

  it("marks nothing for a DeepSeek model behind any base", () => {
    const body = bodyFor(
      "https://gateway.internal/anthropic/",
      "deepseek-chat",
    );

    expect(countBreakpoints(body)).toBe(0);
  });

  it("honours a caller that declared its own budget", () => {
    const api = new AnthropicApi({
      apiKey: "test-key",
      provider: "anthropic",
      apiBase: "https://api.anthropic.com/v1/",
      cacheControlFormat: { maxBreakpoints: 1 },
    } as any);

    const body = (api as any)._convertBody(requestWithStableHeadAndTwoTurns());

    expect(countBreakpoints(body)).toBe(1);
  });

  it("sends nothing marked when caching is switched off", () => {
    const api = new AnthropicApi({
      apiKey: "test-key",
      provider: "anthropic",
      apiBase: "https://api.anthropic.com/v1/",
      cachingStrategy: "none",
    } as any);

    const body = (api as any)._convertBody(requestWithStableHeadAndTwoTurns());

    expect(countBreakpoints(body)).toBe(0);
  });
});
