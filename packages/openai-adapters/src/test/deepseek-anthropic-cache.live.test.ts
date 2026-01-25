/**
 * Live cache test for the Anthropic-compatible route against DeepSeek.
 *
 * The adapter strips explicit breakpoints for a DeepSeek endpoint and relies on
 * the provider's automatic prefix cache. This pins that the reported usage
 * carries the cache split through this route, not only through the OpenAI one.
 *
 * Run: DEEPSEEK_API_KEY=... npx vitest run --config <live-config> \
 *   src/test/deepseek-anthropic-cache.live.test.ts
 */
import { describe, expect, test } from "vitest";

import { constructLlmApi } from "../index.js";

const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_ANTHROPIC_MODEL ?? "deepseek-chat";
const BASE =
  process.env.DEEPSEEK_ANTHROPIC_BASE_URL ??
  "https://api.deepseek.com/anthropic/v1/";

const SYSTEM = [
  "You are a coding assistant working inside a terminal-based agent loop.",
  "Read before editing. Prefer small reversible changes. Run the project's checks.",
  "The following rules are stable and must be identical on every turn.",
]
  .concat(
    Array.from(
      { length: 120 },
      (_, index) =>
        `Rule ${index + 1}: keep the request prefix byte-identical, do not reorder tools, and report evidence with a path and line.`,
    ),
  )
  .join("\n");

function cacheRead(usage: any): number {
  const details = usage?.prompt_tokens_details ?? {};
  return (
    details.cache_read_tokens ??
    details.cached_tokens ??
    details.cached_input_tokens ??
    0
  );
}

describe.skipIf(!API_KEY)("DeepSeek Anthropic-compatible prompt cache", () => {
  const api = constructLlmApi({
    provider: "anthropic",
    apiKey: API_KEY!,
    apiBase: BASE,
  })!;
  const signal = new AbortController().signal;

  test(
    "the second turn reads the prefix the first one warmed",
    { timeout: 120_000 },
    async () => {
      const ask = (question: string) =>
        api.chatCompletionNonStream(
          {
            model: MODEL,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: question },
            ],
            max_tokens: 24,
          },
          signal,
        );

      const first = await ask("Reply with the word one.");
      const second = await ask("Reply with the word two.");

      const firstRead = cacheRead(first.usage);
      const secondRead = cacheRead(second.usage);
      console.log("anthropic-format usage:", {
        first: { prompt: first.usage?.prompt_tokens, cached: firstRead },
        second: { prompt: second.usage?.prompt_tokens, cached: secondRead },
      });

      expect(first.choices.length).toBeGreaterThan(0);
      expect(second.choices.length).toBeGreaterThan(0);
      expect(secondRead).toBeGreaterThan(0);
    },
  );
});
