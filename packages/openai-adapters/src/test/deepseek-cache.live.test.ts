/**
 * Live cache test against a real provider.
 *
 * This is the only evidence that the breakpoint handling actually earns cache
 * reads. A unit test can show a breakpoint was placed, but not that the
 * provider honored it, so the assertions here are on reported usage rather
 * than on request shape.
 *
 * Guarded by an API key env var and skipped when it is not set. The model
 * defaults to a low-cost one so a full run stays cheap.
 *
 * Run: DEEPSEEK_API_KEY=sk-... npx vitest packages/openai-adapters/src/test/deepseek-cache.live.test.ts
 */
import { describe, expect, test } from "vitest";

import { constructLlmApi } from "../index.js";

const API_KEY = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
const MODEL = process.env.CACHE_TEST_MODEL ?? "deepseek-chat";

/**
 * Providers only cache a prefix once it exceeds a minimum length, so the
 * system message below is padded past the smallest threshold any of them
 * enforce. Without it every request would be a cache write and no read.
 */
const LONG_SYSTEM_MESSAGE = [
  "You are a coding assistant working inside a terminal-based agent loop.",
  "You read files before editing them, prefer small reversible changes, and",
  "run the project's own checks rather than assuming they pass.",
  "",
  "Conventions for this workspace:",
  "- Source lives under src/, tests under src/**/*.test.ts.",
  "- Every exported function carries a short comment describing its contract.",
  "- Errors are surfaced to the caller, never swallowed by a bare catch.",
  "- Long-running commands report progress through the tool that started them.",
  "",
  "Additional context that exists only to give the cached prefix some length:",
  ...Array.from(
    { length: 80 },
    (_, i) =>
      `Note ${i}: the agent records tool failures per tool name, not globally.`,
  ),
].join("\n");

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        "Read the contents of a file at the given path. Use this when you need to examine existing files in the project. The output includes line numbers prefixed to each line. When reading large files, you may want to specify a line range using the start_line and end_line parameters.",
      parameters: {
        type: "object" as const,
        required: ["path"],
        properties: {
          path: { type: "string", description: "The path of the file to read" },
          start_line: { type: "number", description: "Line to start from" },
          end_line: { type: "number", description: "Line to end at" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search",
      description:
        "Search for a pattern across files using ripgrep. Provide a query and optionally a path glob. Returns matching lines with their file paths.",
      parameters: {
        type: "object" as const,
        required: ["query"],
        properties: {
          query: { type: "string", description: "The pattern to search for" },
          path: {
            type: "string",
            description: "Optional glob to filter paths",
          },
        },
      },
    },
  },
];

function cacheReadTokens(usage: any): number {
  const details = usage?.prompt_tokens_details ?? usage?.input_tokens_details;
  return (
    details?.cached_tokens ??
    details?.cache_read_tokens ??
    usage?.cache_read_tokens ??
    0
  );
}

function cacheWriteTokens(usage: any): number {
  const details = usage?.prompt_tokens_details ?? usage?.input_tokens_details;
  return (
    details?.cache_write_tokens ??
    details?.cache_creation_tokens ??
    usage?.cache_write_tokens ??
    0
  );
}

describe.skipIf(!API_KEY)(`${MODEL} prompt cache - live API`, () => {
  const api = constructLlmApi({
    provider: "deepseek",
    apiKey: API_KEY!,
  })!;

  const signal = new AbortController().signal;
  let messages: any[] = [];

  test(
    "first request populates the cache and later ones read from it",
    { timeout: 120_000 },
    async () => {
      const turns = [
        "In one short sentence, what is the purpose of a build cache?",
        "In one short sentence, what problem does a lock file solve?",
        "In one short sentence, why does a cache key include the model name?",
      ];

      const reads: number[] = [];

      for (const question of turns) {
        // The question joins the history rather than replacing it, so the
        // system prompt and tool definitions stay byte-identical across turns.
        // That identical prefix is the thing being cached.
        messages = [...messages, { role: "user", content: question }];

        const response = await api.chatCompletionNonStream(
          {
            model: MODEL,
            system: LONG_SYSTEM_MESSAGE,
            messages,
            tools: TOOLS,
            max_tokens: 64,
          } as any,
          signal,
        );

        expect(response.choices.length).toBeGreaterThan(0);
        const usage: any = response.usage;
        reads.push(cacheReadTokens(usage));

        messages = [
          ...messages,
          { role: "assistant", content: response.choices[0].message.content },
        ];

        console.log("turn usage:", {
          prompt_tokens: usage?.prompt_tokens,
          cached: cacheReadTokens(usage),
          cache_write: cacheWriteTokens(usage),
        });
      }

      // The first request has nothing to read, so it may only write.
      expect(reads[0]).toBe(0);

      // Every later request reuses the same system prompt and tool
      // definitions, so each must report a cache read. A run that reports zero
      // here is paying full price for a prefix it has already sent.
      expect(reads.slice(1).every((n) => n > 0)).toBe(true);
    },
  );
});
