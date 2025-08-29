import type { ChatHistoryItem } from "core/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSession, getCurrentSession } from "../session/index.js";

import {
  streamChatResponseWithInterruption,
  titleServeSessionIfUntitled,
} from "./serve.helpers.js";

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

/**
 * Served sessions used to keep "Untitled Session" in `tnt ls` because no
 * title call exists in the serve path, while headless and TUI title theirs.
 */
describe("serve session titles", () => {
  const userTurn = [
    { message: { role: "user", content: "hi" }, contextItems: [] },
  ] as unknown as ChatHistoryItem[];

  function fakeLlm() {
    return {
      chatCompletionNonStream: vi.fn(async () => ({
        choices: [{ message: { content: "Auth flow map" } }],
      })),
    };
  }

  it("names an untitled session from its first reply", async () => {
    const session = createSession(userTurn);
    const llmApi = fakeLlm();

    const title = await titleServeSessionIfUntitled(
      session,
      "The assistant replied.",
      llmApi as never,
      { model: "test-model" } as never,
    );

    expect(title).toBe("Auth flow map");
    expect(getCurrentSession().title).toBe("Auth flow map");
    expect(llmApi.chatCompletionNonStream).toHaveBeenCalledTimes(1);
  });

  it("keeps a title that was set earlier", async () => {
    const session = createSession(userTurn);
    session.title = "Existing title";
    const llmApi = fakeLlm();

    const title = await titleServeSessionIfUntitled(
      session,
      "The assistant replied.",
      llmApi as never,
      { model: "test-model" } as never,
    );

    expect(title).toBeUndefined();
    expect(llmApi.chatCompletionNonStream).not.toHaveBeenCalled();
    expect(session.title).toBe("Existing title");
  });

  it("does not title from an empty reply", async () => {
    const session = createSession(userTurn);
    const llmApi = fakeLlm();

    const title = await titleServeSessionIfUntitled(
      session,
      "   ",
      llmApi as never,
      { model: "test-model" } as never,
    );

    expect(title).toBeUndefined();
    expect(llmApi.chatCompletionNonStream).not.toHaveBeenCalled();
  });
});
