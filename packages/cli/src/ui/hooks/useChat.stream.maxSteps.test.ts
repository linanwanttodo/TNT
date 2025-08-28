import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeStreaming } from "./useChat.stream.helpers.js";

const { streamChatResponse } = vi.hoisted(() => ({
  streamChatResponse: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("../../stream/streamChatResponse.js", () => ({ streamChatResponse }));
vi.mock("../../compaction/index.js", () => ({ getHistoryForLLM: vi.fn() }));

function streamingOptions(extra: Record<string, unknown> = {}) {
  return {
    chatHistory: [],
    model: {},
    llmApi: {},
    controller: new AbortController(),
    streamCallbacks: {},
    currentCompactionIndex: null,
    ...extra,
  };
}

/**
 * The CLI flag has to survive the TUI hop: the interactive path used to call
 * the stream without a turn budget, so --max-steps only ever worked headless.
 */
describe("executeStreaming turn budget", () => {
  beforeEach(() => {
    streamChatResponse.mockClear();
  });

  it("passes the step budget to the stream", async () => {
    await executeStreaming(streamingOptions({ maxSteps: 7 }) as never);

    expect(streamChatResponse).toHaveBeenCalledWith(
      [],
      {},
      {},
      expect.any(AbortController),
      {},
      false,
      { maxSteps: 7 },
    );
  });

  it("leaves the budget at its default when no cap is set", async () => {
    await executeStreaming(streamingOptions() as never);

    expect(streamChatResponse.mock.calls[0][6]).toBeUndefined();
  });
});
