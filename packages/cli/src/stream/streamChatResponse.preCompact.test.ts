import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  generation: 0,
  session: { sessionId: "pre-compact", history: [] as any[] },
}));

const hookState = vi.hoisted(() => ({
  calls: [] as string[],
  result: { blocked: false, results: [] } as Record<string, unknown>,
}));

vi.mock("../hooks/fireHook.js", () => ({
  firePreCompact: async (trigger: string) => {
    hookState.calls.push(`preCompact:${trigger}`);
    return { blocked: false, results: [], ...hookState.result };
  },
}));

vi.mock("../compaction/index.js", () => ({
  compactChatHistory: vi.fn(async () => {
    hookState.calls.push("compact");
    return {
      compactedHistory: convertToUnifiedHistory([
        { role: "system", content: "[COMPACTED HISTORY]" },
      ]),
      compactionIndex: 0,
      compactionContent: "[COMPACTED HISTORY]",
    };
  }),
  findCompactionIndex: vi.fn(() => null),
  shouldAutoCompact: vi.fn(() => true),
  getAutoCompactMessage: vi.fn(() => "Compacting..."),
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => sessionState.session),
  getSessionHistoryGeneration: vi.fn(() => sessionState.generation),
  replaceSessionHistoryIfGeneration: vi.fn((generation, history) => {
    if (sessionState.generation !== generation) return false;
    sessionState.session.history = history;
    sessionState.generation++;
    return true;
  }),
}));

vi.mock("../utils/tokenizer.js", () => ({
  countChatHistoryItemTokens: vi.fn(() => 100),
}));

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { handleAutoCompaction } from "./streamChatResponse.autoCompaction.js";

const model = {
  provider: "openai",
  name: "gpt-4",
  model: "gpt-4",
  defaultCompletionOptions: { contextLength: 8192, maxTokens: 2048 },
} as any;

const llmApi = {} as any;

const history: ChatHistoryItem[] = convertToUnifiedHistory([
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there!" },
]);

/**
 * PreCompact belongs to the engine that compacts, not to the surface that shows
 * a progress bar: headless and serve runs summarized the history without ever
 * telling the hooks, and the TUI announced it after the fact.
 */
describe("PreCompact around compaction", () => {
  beforeEach(() => {
    hookState.calls.length = 0;
    hookState.result = { blocked: false, results: [] };
    sessionState.generation = 0;
    sessionState.session = { sessionId: "pre-compact", history: [] };
  });

  it("tells the hooks before it summarizes", async () => {
    const result = await handleAutoCompaction(history, model, llmApi, {
      force: true,
    });

    expect(hookState.calls).toEqual(["preCompact:auto", "compact"]);
    expect(result.wasCompacted).toBe(true);
  });

  it("does not summarize when the hook refuses", async () => {
    hookState.result = {
      blocked: true,
      blockReason: "keep the full transcript",
      results: [],
    };

    const result = await handleAutoCompaction(history, model, llmApi, {
      force: true,
    });

    expect(hookState.calls).toEqual(["preCompact:auto"]);
    expect(result.wasCompacted).toBe(false);
    expect(result.chatHistory).toEqual(history);
  });

  it("says nothing when it is not going to summarize", async () => {
    const { shouldAutoCompact } = await import("../compaction/index.js");
    vi.mocked(shouldAutoCompact).mockReturnValueOnce(false);

    const result = await handleAutoCompaction(history, model, llmApi);

    expect(hookState.calls).toEqual([]);
    expect(result.wasCompacted).toBe(false);
  });
});
