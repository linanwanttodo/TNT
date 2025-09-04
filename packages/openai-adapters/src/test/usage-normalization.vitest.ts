import { describe, expect, it } from "vitest";

import { anthropicUsage } from "../apis/Anthropic.js";
import { normalizeUsage } from "../util.js";

/**
 * Every provider counts the same tokens with a different field name, and the
 * engine, the cost calculation and the cache telemetry read them. These cases are
 * the dialects each adapter actually receives, so a rename inside one provider's
 * payload cannot quietly turn a cache hit into a miss again.
 */
describe("normalizeUsage", () => {
  it("folds the OpenAI chat spelling into both cache names", () => {
    const usage = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 20,
      total_tokens: 1020,
      prompt_tokens_details: { cached_tokens: 800 },
    });

    expect(usage?.prompt_tokens_details).toEqual({
      cached_tokens: 800,
      cache_read_tokens: 800,
    });
  });

  it("reads the Responses API details it used to drop", () => {
    const usage = normalizeUsage({
      input_tokens: 900,
      output_tokens: 40,
      total_tokens: 940,
      input_tokens_details: { cached_tokens: 700 },
      output_tokens_details: { reasoning_tokens: 25 },
    });

    expect(usage?.prompt_tokens).toBe(900);
    expect(usage?.completion_tokens).toBe(40);
    expect(usage?.prompt_tokens_details?.cache_read_tokens).toBe(700);
    expect(usage?.completion_tokens_details?.reasoning_tokens).toBe(25);
  });

  it("reads Gemini's metadata, including the cached and thinking parts", () => {
    const usage = normalizeUsage({
      promptTokenCount: 2000,
      candidatesTokenCount: 150,
      totalTokenCount: 2150,
      cachedContentTokenCount: 1600,
      thoughtsTokenCount: 100,
    });

    expect(usage?.prompt_tokens).toBe(2000);
    expect(usage?.prompt_tokens_details?.cache_read_tokens).toBe(1600);
    expect(usage?.completion_tokens_details?.reasoning_tokens).toBe(100);
  });

  it("reads the camelCase a Vercel-style converter emits", () => {
    const usage = normalizeUsage({
      inputTokens: 500,
      outputTokens: 30,
      cacheReadTokens: 400,
      cacheWriteTokens: 60,
    });

    expect(usage?.total_tokens).toBe(530);
    expect(usage?.prompt_tokens_details).toEqual({
      cached_tokens: 400,
      cache_read_tokens: 400,
      cache_write_tokens: 60,
    });
  });

  it("reads the nested camelCase details a Vercel or AiSdk result carries", () => {
    const usage = normalizeUsage({
      inputTokens: 800,
      outputTokens: 60,
      totalTokens: 860,
      inputTokenDetails: { cacheReadTokens: 500, cacheWriteTokens: 90 },
      outputTokenDetails: { reasoningTokens: 40 },
    });

    expect(usage?.prompt_tokens_details).toEqual({
      cached_tokens: 500,
      cache_read_tokens: 500,
      cache_write_tokens: 90,
    });
    expect(usage?.completion_tokens_details?.reasoning_tokens).toBe(40);
  });

  it("adds the total when a provider only sends the parts", () => {
    expect(
      normalizeUsage({ prompt_tokens: 70, completion_tokens: 8 })?.total_tokens,
    ).toBe(78);
  });

  it("leaves a field out rather than inventing a zero", () => {
    const usage = normalizeUsage({ completion_tokens: 12 });

    expect(usage?.prompt_tokens).toBeUndefined();
    expect(usage?.completion_tokens).toBe(12);
    expect(usage?.prompt_tokens_details).toBeUndefined();
  });

  it("returns nothing for a payload that holds no counts", () => {
    expect(normalizeUsage(undefined)).toBeUndefined();
    expect(normalizeUsage(null)).toBeUndefined();
    expect(normalizeUsage({})).toBeUndefined();
    expect(normalizeUsage({ model: "gpt" })).toBeUndefined();
  });

  it("ignores a count that is not a usable number", () => {
    const usage = normalizeUsage({
      prompt_tokens: -5,
      completion_tokens: Number.NaN,
      total_tokens: "42",
    });

    expect(usage).toBeUndefined();
  });
});

describe("anthropicUsage", () => {
  it("meters the whole prefix, not only the fresh part", () => {
    const usage = anthropicUsage({
      input_tokens: 12,
      output_tokens: 340,
      cache_read_input_tokens: 98000,
      cache_creation_input_tokens: 1200,
    });

    expect(usage?.prompt_tokens).toBe(99212);
    expect(usage?.completion_tokens).toBe(340);
    expect(usage?.total_tokens).toBe(99552);
    expect(usage?.prompt_tokens_details?.cache_read_tokens).toBe(98000);
    expect(usage?.prompt_tokens_details?.cache_write_tokens).toBe(1200);
  });

  it("keeps a small uncached request as the provider reported it", () => {
    const usage = anthropicUsage({ input_tokens: 30, output_tokens: 4 });

    expect(usage?.prompt_tokens).toBe(30);
    expect(usage?.prompt_tokens_details).toBeUndefined();
  });

  it("ignores the nested cache_creation object a newer API sends", () => {
    const usage = anthropicUsage({
      input_tokens: 20,
      output_tokens: 5,
      cache_creation: { ephemeral_5m_input_tokens: 300 },
    });

    expect(usage?.prompt_tokens).toBe(20);
    expect(usage?.prompt_tokens_details).toBeUndefined();
  });

  it("returns nothing when the response carried no usage at all", () => {
    expect(anthropicUsage(undefined)).toBeUndefined();
  });
});
