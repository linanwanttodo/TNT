import type { ChatHistoryItem } from "core/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSession, getCurrentSession } from "../session/index.js";

import {
  streamServeResponse,
  titleServeSessionIfUntitled,
} from "./serve.helpers.js";

const { streamChatResponse } = vi.hoisted(() => ({
  streamChatResponse: vi.fn(async (..._args: unknown[]) => "ok"),
}));
vi.mock("../stream/streamChatResponse.js", () => ({ streamChatResponse }));

beforeEach(() => {
  streamChatResponse.mockClear();
});

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
  it("passes the step budget to the stream", async () => {
    await streamServeResponse(state as never, {}, new AbortController(), {
      maxSteps: 5,
    });

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
    await streamServeResponse(state as never, {}, new AbortController());

    expect(streamChatResponse.mock.calls[0][6]).toBeUndefined();
  });

  it("holds no polling timer of its own", async () => {
    // Interruption is the abort controller's job. A poll used to run here every
    // 100ms against a callback the caller passed as `() => false`, so all it
    // did was keep a timer alive during every served response.
    vi.useFakeTimers();
    try {
      await streamServeResponse(state as never, {}, new AbortController());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Serve seeds the session with the system prompt and the request header
 * injects the same prompt, so streams used to carry two system messages.
 */
describe("serve request history", () => {
  it("drops the seeded system message the header re-injects", async () => {
    const history = [
      { message: { role: "system", content: "system" }, contextItems: [] },
      { message: { role: "user", content: "hi" }, contextItems: [] },
    ] as unknown as ChatHistoryItem[];

    await streamServeResponse(
      { ...state, session: { history } } as never,
      {},
      new AbortController(),
    );

    expect(streamChatResponse.mock.calls[0][0]).toEqual([history[1]]);
  });

  it("passes a history without a leading system message unchanged", async () => {
    const history = [
      { message: { role: "user", content: "hi" }, contextItems: [] },
    ] as unknown as ChatHistoryItem[];

    await streamServeResponse(
      { ...state, session: { history } } as never,
      {},
      new AbortController(),
    );

    expect(streamChatResponse.mock.calls[0][0]).toBe(history);
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
