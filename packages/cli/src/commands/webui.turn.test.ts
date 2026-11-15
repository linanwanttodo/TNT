import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentSession } from "../session/index.js";
import type { QueuedMessage } from "../stream/messageQueue.js";

import { removePartialAssistantMessage } from "./serve.helpers.js";
import { runStandaloneTurn } from "./webui.js";

const runAgentTurnMock = vi.fn();

vi.mock("../session/controller.js", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurnMock(...args),
}));

vi.mock("../agent/atMentions.js", () => ({
  expandMentions: vi.fn(() => ({ contextItems: [] })),
}));

vi.mock("./serve.helpers.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareServedPrompt: vi.fn(() => Promise.resolve({ text: "hi" })),
  finishServedTurn: vi.fn(),
  titleServeSessionIfUntitled: vi.fn(),
  removePartialAssistantMessage: vi.fn(),
  checkAgentComplete: vi.fn(() => true),
  buildServedStreamCallbacks: vi.fn(() => ({})),
}));

vi.mock("../telemetry/telemetryService.js", () => ({
  default: {
    recordSessionStart: vi.fn(),
    startActiveTime: vi.fn(),
    stopActiveTime: vi.fn(),
    updateOrganization: vi.fn(),
  },
}));

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

/**
 * The drain loop hands every turn a signal it may abort; Stop truncation only
 * works if that signal reaches the controller runAgentTurn polls.
 */
describe("runStandaloneTurn", () => {
  beforeEach(() => {
    runAgentTurnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A turn writes to the session the process currently holds (a /session/
   * select can re-point it between messages), so the harness plants its
   * history array on the SessionManager's current session.
   */
  const makeState = () => {
    const session = getCurrentSession();
    session.history = [];
    return {
      session,
      model: { model: "m" },
      serverRunning: true,
    };
  };

  const makeQueued = (): QueuedMessage =>
    ({
      message: "hi",
      imageMap: new Map<string, Buffer>(),
    }) as QueuedMessage;

  it("wires the drain signal into the abort controller runAgentTurn polls", async () => {
    const drain = new AbortController();
    let observed: AbortSignal | undefined;
    runAgentTurnMock.mockImplementation(async (options: any) => {
      observed = options.abortController.signal;
      drain.abort();
      return "ok";
    });

    await runStandaloneTurn(
      makeState() as any,
      {} as any,
      { model: "m" },
      makeQueued(),
      drain.signal,
    );

    expect(observed?.aborted).toBe(true);
  });

  it("classifies an aborted drain signal as an interruption, not an error", async () => {
    const drain = new AbortController();
    runAgentTurnMock.mockImplementation(async () => {
      drain.abort();
      const e = new Error("Premature close");
      throw e;
    });

    const state = makeState() as any;
    await runStandaloneTurn(
      state,
      {} as any,
      { model: "m" },
      makeQueued(),
      drain.signal,
    );

    expect(removePartialAssistantMessage).toHaveBeenCalledWith(
      state.session.history,
    );
  });

  it("records a real failure as an assistant error message", async () => {
    const { services } = await import("../services/index.js");
    const chatHistory = (services as any).chatHistory;
    const addUser = vi
      .spyOn(chatHistory, "addUserMessage")
      .mockImplementation(() => {
        throw new Error("uninitialized");
      });
    const addAssistant = vi
      .spyOn(chatHistory, "addAssistantMessage")
      .mockImplementation(() => {
        throw new Error("uninitialized");
      });

    try {
      runAgentTurnMock.mockRejectedValue(new Error("boom"));

      const state = makeState() as any;
      await runStandaloneTurn(
        state,
        {} as any,
        { model: "m" },
        makeQueued(),
        new AbortController().signal,
      );

      expect(state.session.history).toHaveLength(2);
      expect(state.session.history[0].message.role).toBe("user");
      expect(state.session.history[1].message.content).toContain("boom");
    } finally {
      addUser.mockRestore();
      addAssistant.mockRestore();
    }
  });

  it("lands on the session the process now holds after a switch", async () => {
    // The SessionManager is where /session/select installs the switched
    // session; a turn that captured a stale history array would write the
    // message into the conversation the user just left.
    const { loadOrCreateSessionById } = await import("../session/index.js");
    const switched = loadOrCreateSessionById("webui-turn-switched", []);
    runAgentTurnMock.mockResolvedValue("ok");
    await runStandaloneTurn(
      makeState() as any,
      {} as any,
      { model: "m" },
      makeQueued(),
      new AbortController().signal,
    );

    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    expect(runAgentTurnMock.mock.calls[0][0].chatHistory).toBe(
      switched.history,
    );
  });

  it("runs the turn on the model the service holds now", async () => {
    // The browser's model chip switches the model while the process lives;
    // a turn that kept the startup model would answer with the old one.
    const { services } = await import("../services/index.js");
    const live = { llmApi: { name: "live" }, model: { model: "live" } };
    const getState = vi
      .spyOn(services.model, "getState")
      .mockReturnValue(live as any);
    runAgentTurnMock.mockResolvedValue("ok");

    try {
      await runStandaloneTurn(
        makeState() as any,
        {} as any,
        { model: "m" },
        makeQueued(),
        new AbortController().signal,
      );

      expect(runAgentTurnMock.mock.calls[0][0].model).toBe(live.model);
      expect(runAgentTurnMock.mock.calls[0][0].llmApi).toBe(live.llmApi);
    } finally {
      getState.mockRestore();
    }
  });

  it("keeps the startup model when the service holds none", async () => {
    const { services } = await import("../services/index.js");
    const getState = vi
      .spyOn(services.model, "getState")
      .mockReturnValue({ llmApi: null, model: null } as any);
    runAgentTurnMock.mockResolvedValue("ok");

    try {
      await runStandaloneTurn(
        makeState() as any,
        { name: "startup" } as any,
        { model: "m" },
        makeQueued(),
        new AbortController().signal,
      );

      expect(runAgentTurnMock.mock.calls[0][0].model).toEqual({ model: "m" });
      expect(runAgentTurnMock.mock.calls[0][0].llmApi).toEqual({
        name: "startup",
      });
    } finally {
      getState.mockRestore();
    }
  });
});
