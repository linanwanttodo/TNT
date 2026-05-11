import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueuedMessage } from "../stream/messageQueue.js";

const runAgentTurnMock = vi.fn();

vi.mock("../session/controller.js", () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurnMock(...args),
}));

vi.mock("../agent/atMentions.js", () => ({
  expandMentions: vi.fn(() => ({ contextItems: [] })),
}));

vi.mock("./serve.helpers.js", () => ({
  prepareServedPrompt: vi.fn(() => Promise.resolve({ text: "hi" })),
  finishServedTurn: vi.fn(),
  titleServeSessionIfUntitled: vi.fn(),
  removePartialAssistantMessage: vi.fn(),
  checkAgentComplete: vi.fn(() => true),
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

import { removePartialAssistantMessage } from "./serve.helpers.js";
import { runStandaloneTurn } from "./webui.js";

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

  const makeState = () => ({
    session: { history: [] as any[], title: "s" },
    model: { model: "m" },
    serverRunning: true,
  });

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
});
