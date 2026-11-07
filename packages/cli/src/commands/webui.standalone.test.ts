import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { QueuedMessage } from "../stream/messageQueue.js";

vi.mock("../session/controller.js", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurnMock(...args),
}));

vi.mock("../agent/atMentions.js", () => ({
  expandMentions: vi.fn(() => ({ contextItems: [] })),
}));

// Real serve.helpers for the callbacks builder; only the turn-lifecycle
// helpers are stubbed so the standalone turn runs without hooks or HTTP.
vi.mock("./serve.helpers.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareServedPrompt: vi.fn(() => Promise.resolve({ text: "hi" })),
  finishServedTurn: vi.fn(),
  titleServeSessionIfUntitled: vi.fn(),
  removePartialAssistantMessage: vi.fn(),
  checkAgentComplete: vi.fn(() => true),
}));

vi.mock("../telemetry/telemetryService.js", () => ({
  telemetryService: {
    recordSessionStart: vi.fn(),
    startActiveTime: vi.fn(),
    stopActiveTime: vi.fn(),
    updateOrganization: vi.fn(),
  },
}));

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { buildServedStreamCallbacks } from "./serve.helpers.js";
import { runStandaloneTurn } from "./webui.js";

const runAgentTurnMock = vi.hoisted(() => vi.fn());

describe("webui standalone permission wiring", () => {
  beforeEach(() => {
    runAgentTurnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeState = () =>
    ({
      session: { history: [] as any[], title: "s" },
      model: { model: "m" },
      serverRunning: true,
      pendingPermission: null,
    }) as any;

  const makeQueued = (): QueuedMessage =>
    ({ message: "hi", imageMap: new Map<string, Buffer>() }) as QueuedMessage;

  it("hands served stream callbacks to the controller turn (T1.1)", async () => {
    runAgentTurnMock.mockResolvedValue("ok");
    const state = makeState();

    await runStandaloneTurn(
      state,
      {} as any,
      { model: "m" },
      makeQueued(),
      new AbortController().signal,
    );

    const options = runAgentTurnMock.mock.calls[0][0] as any;
    expect(options.callbacks).toBeDefined();

    // The served builder records the request for the HTTP face to expose.
    options.callbacks.onToolPermissionRequest!(
      "Bash",
      { command: "ls" },
      "req-1",
      [],
    );
    expect(state.pendingPermission).toMatchObject({
      requestId: "req-1",
      toolName: "Bash",
    });
  });

  it("clears pending permission once the turn settles (T1.2)", async () => {
    runAgentTurnMock.mockImplementation(async () => {
      return "ok";
    });
    const state = makeState();
    state.pendingPermission = {
      toolName: "Bash",
      toolArgs: {},
      requestId: "req-1",
      timestamp: Date.now(),
    };

    await runStandaloneTurn(
      state,
      {} as any,
      { model: "m" },
      makeQueued(),
      new AbortController().signal,
    );

    expect(state.pendingPermission).toBeNull();
  });

  it("clears pending permission when the turn fails (T1.6)", async () => {
    runAgentTurnMock.mockRejectedValue(new Error("boom"));
    const state = makeState();
    state.pendingPermission = {
      toolName: "Bash",
      toolArgs: {},
      requestId: "req-1",
      timestamp: Date.now(),
    };

    await runStandaloneTurn(
      state,
      {} as any,
      { model: "m" },
      makeQueued(),
      new AbortController().signal,
    );

    expect(state.pendingPermission).toBeNull();
  });

  it("does not preload a system item into the session history (T1.5)", async () => {
    const { services } = await import("../services/index.js");
    const chatHistory = (services as any).chatHistory;
    // Push the user message into the session array so the history roles are
    // observable; ChatHistoryService would otherwise be the source of truth.
    const addUser = vi
      .spyOn(chatHistory, "addUserMessage")
      .mockImplementation(() => {
        throw new Error("uninitialized");
      });

    try {
      runAgentTurnMock.mockResolvedValue("ok");
      const state = makeState();
      // The turn writes history through the process's current session, so the
      // test pins that lookup to the state under assertion.
      const sessionModule = await import("../session/index.js");
      const currentSession = vi
        .spyOn(sessionModule, "getCurrentSession")
        .mockReturnValue(state.session);

      try {
        await runStandaloneTurn(
          state,
          {} as any,
          { model: "m" },
          makeQueued(),
          new AbortController().signal,
        );
      } finally {
        currentSession.mockRestore();
      }

      // Only the user message lands; the engine injects the system prompt at
      // request time, so the request cannot carry two copies of it.
      const roles = state.session.history.map((item: any) => item.message.role);
      expect(roles).toEqual(["user"]);
    } finally {
      addUser.mockRestore();
    }
  });
});

describe("buildServedStreamCallbacks", () => {
  it("records the pending permission and survives an uninitialized history service", () => {
    const state = { pendingPermission: null } as any;
    const callbacks = buildServedStreamCallbacks(state);

    expect(() =>
      callbacks.onToolPermissionRequest!("Bash", { command: "ls" }, "req-2", [
        { type: "text", content: "preview" },
      ]),
    ).not.toThrow();

    expect(state.pendingPermission).toMatchObject({
      requestId: "req-2",
      toolName: "Bash",
      toolArgs: { command: "ls" },
    });
  });

  it("records system notices through the callbacks without throwing", () => {
    const state = { pendingPermission: null } as any;
    const callbacks = buildServedStreamCallbacks(state);

    expect(() =>
      callbacks.onSystemMessage!("compaction happened"),
    ).not.toThrow();
    expect(state.pendingPermission).toBeNull();
  });
});
