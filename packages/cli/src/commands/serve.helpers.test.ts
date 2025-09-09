import type { ChatHistoryItem } from "core/index.js";
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { markFileAsSeen } from "../tools/fileState.js";
import { createSession, getCurrentSession } from "../session/index.js";

import {
  endServedSession,
  finishServedTurn,
  prepareServedPrompt,
  startServedSession,
  streamServeResponse,
  titleServeSessionIfUntitled,
} from "./serve.helpers.js";

const { streamChatResponse } = vi.hoisted(() => ({
  streamChatResponse: vi.fn(async (..._args: unknown[]) => "ok"),
}));
vi.mock("../stream/streamChatResponse.js", () => ({ streamChatResponse }));

const hooks = vi.hoisted(() => {
  const ok = async (
    ..._args: unknown[]
  ): Promise<Partial<import("../hooks/types.js").HookEventResult>> => ({
    blocked: false,
    results: [],
  });
  return {
    userPromptSubmit: vi.fn(ok),
    sessionStart: vi.fn(ok),
    sessionStartContext: vi.fn(() => undefined as string | undefined),
    sessionEnd: vi.fn(ok),
    stop: vi.fn(ok),
  };
});
vi.mock("../hooks/fireHook.js", () => ({
  fireUserPromptSubmit: (...args: unknown[]) => hooks.userPromptSubmit(...args),
  fireSessionStart: (...args: unknown[]) => hooks.sessionStart(...args),
  fireSessionEnd: (...args: unknown[]) => hooks.sessionEnd(...args),
  fireStop: (...args: unknown[]) => hooks.stop(...args),
  takeSessionStartContext: () => hooks.sessionStartContext(),
}));

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

/**
 * `tnt serve` is the mode the web client uses, and it fired no lifecycle event
 * at all: a hooks.json written for the reference saw tool calls with no session
 * around them.
 */
describe("serve lifecycle hooks", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-serve-hooks-"));

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    hooks.userPromptSubmit.mockReset();
    hooks.userPromptSubmit.mockResolvedValue({ blocked: false, results: [] });
    hooks.sessionStart.mockReset();
    hooks.sessionEnd.mockReset();
    hooks.stop.mockReset();
    hooks.sessionStartContext.mockReset();
    hooks.sessionStartContext.mockReturnValue(undefined);
  });

  it("announces the session it is about to host", async () => {
    await startServedSession(true, "gpt-4");
    expect(hooks.sessionStart).toHaveBeenCalledWith("resume", "gpt-4");

    await startServedSession(false, "gpt-4");
    expect(hooks.sessionStart).toHaveBeenCalledWith("startup", "gpt-4");
  });

  it("ends the session on the way out", async () => {
    await endServedSession("other");
    expect(hooks.sessionEnd).toHaveBeenCalledWith("other");
  });

  it("asks the prompt hook before the message reaches the history", async () => {
    hooks.userPromptSubmit.mockResolvedValue({
      blocked: false,
      results: [],
      additionalContext: "style: two spaces",
    });

    const prepared = await prepareServedPrompt("fix the file");

    expect(hooks.userPromptSubmit).toHaveBeenCalledWith("fix the file");
    expect(prepared.blocked).toBe(false);
    expect(prepared.text).toBe("style: two spaces\n\nfix the file");
  });

  it("leads with the session note on the first prompt only", async () => {
    hooks.sessionStartContext.mockReturnValueOnce("repo uses pnpm");
    hooks.userPromptSubmit.mockResolvedValue({
      blocked: false,
      results: [],
      additionalContext: "style: two spaces",
    });

    const first = await prepareServedPrompt("one");
    const second = await prepareServedPrompt("two");

    expect(first.text).toBe("repo uses pnpm\n\nstyle: two spaces\n\none");
    expect(second.text).toBe("style: two spaces\n\ntwo");
  });

  it("surfaces a refused prompt instead of running the turn", async () => {
    hooks.userPromptSubmit.mockResolvedValue({
      blocked: true,
      blockReason: "no deploys from serve",
      results: [],
    });

    const prepared = await prepareServedPrompt("deploy it");

    expect(prepared.blocked).toBe(true);
    expect(prepared.blockReason).toBe("no deploys from serve");
  });

  it("treats a finished turn as a Stop", async () => {
    await finishServedTurn("done, tests pass");

    expect(hooks.stop).toHaveBeenCalledWith("done, tests pass");
  });

  it("survives a hook that throws", async () => {
    hooks.userPromptSubmit.mockRejectedValue(new Error("boom"));

    const prepared = await prepareServedPrompt("keep going");

    expect(prepared.blocked).toBe(false);
    expect(prepared.text).toBe("keep going");
  });

  it("carries a moved file in front of the served prompt", async () => {
    const target = path.join(workDir, "moved.ts");
    fs.writeFileSync(target, "export const a = 1;\n");
    markFileAsSeen(target);
    fs.writeFileSync(target, "export const a = 22;\n");

    const prepared = await prepareServedPrompt("continue");

    // The write tools would refuse this file until it is read again; saying so
    // first saves the model a call.
    expect(prepared.text).toContain("changed on disk since you read them");
    expect(prepared.text.endsWith("\n\ncontinue")).toBe(true);
  });
});
