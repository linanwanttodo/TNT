import { describe, expect, it } from "vitest";

import { cacheTokensFrom } from "./streamChatResponse.helpers.js";

/**
 * The adapters fold every provider into one usage shape, but a request that came
 * through core can still carry only the OpenAI spelling of a cache hit. This is
 * where the two are reconciled, so a hit cannot be reported as a miss because of
 * a field name - which is what made the status bar's ratio read zero.
 */
describe("cacheTokensFrom", () => {
  it("reads the canonical cache names the adapters emit", () => {
    expect(
      cacheTokensFrom({
        prompt_tokens_details: {
          cache_read_tokens: 800,
          cache_write_tokens: 20,
        },
      }),
    ).toEqual({ cacheReadTokens: 800, cacheWriteTokens: 20 });
  });

  it("falls back to the OpenAI name when only it was sent", () => {
    expect(
      cacheTokensFrom({ prompt_tokens_details: { cached_tokens: 640 } }),
    ).toEqual({ cacheReadTokens: 640 });
  });

  it("prefers the canonical name when a provider sends both", () => {
    expect(
      cacheTokensFrom({
        prompt_tokens_details: { cached_tokens: 1, cache_read_tokens: 900 },
      }),
    ).toEqual({ cacheReadTokens: 900 });
  });

  it("keeps a reported zero as zero instead of dropping it", () => {
    expect(
      cacheTokensFrom({ prompt_tokens_details: { cached_tokens: 0 } }),
    ).toEqual({ cacheReadTokens: 0 });
  });

  it("says nothing when the usage holds nothing", () => {
    expect(cacheTokensFrom(undefined)).toEqual({});
    expect(cacheTokensFrom({})).toEqual({});
    expect(cacheTokensFrom({ prompt_tokens_details: {} })).toEqual({});
  });
});
