import { beforeEach, describe, expect, it, vi } from "vitest";

import { streamChatResponseWithInterruption } from "./serve.helpers.js";

const { streamChatResponse } = vi.hoisted(() => ({
  streamChatResponse: vi.fn(async (..._args: unknown[]) => "ok"),
}));
vi.mock("../stream/streamChatResponse.js", () => ({ streamChatResponse }));

const state = {
  session: { history: [] },
  model: {},
  isProcessing: false,
  lastActivity: 0,
  currentAbortController: null,
  serverRunning: true,
  pendingPermission: null,
};

/**
 * --max-steps reached neither serve's stream call nor its flag merge until
 * this wiring existed; the headless and TUI paths already pass the budget.
 */
describe("serve stream turn budget", () => {
  beforeEach(() => {
    streamChatResponse.mockClear();
  });

  it("passes the step budget to the stream", async () => {
    await streamChatResponseWithInterruption(
      state as never,
      {},
      new AbortController(),
      () => false,
      { maxSteps: 5 },
    );

    expect(streamChatResponse).toHaveBeenCalledWith(
      [],
      {},
      {},
      expect.any(AbortController),
      expect.any(Object),
      false,
      { maxSteps: 5 },
    );
  });

  it("leaves the budget at its default without a cap", async () => {
    await streamChatResponseWithInterruption(
      state as never,
      {},
      new AbortController(),
      () => false,
    );

    expect(streamChatResponse.mock.calls[0][6]).toBeUndefined();
  });
});
