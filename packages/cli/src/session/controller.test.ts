import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "../protocol/events.js";

const { streamChatResponse } = vi.hoisted(() => ({
  streamChatResponse: vi.fn(),
}));

vi.mock("../stream/streamChatResponse.js", () => ({ streamChatResponse }));

import { runAgentTurn, startAgentTurn } from "./controller.js";

function eventsOf(): {
  events: AgentEvent[];
  onEvent: (event: AgentEvent) => void;
} {
  const events: AgentEvent[] = [];
  return { events, onEvent: (event) => events.push(event) };
}

const model = { model: "test-model" } as never;
const llmApi = {} as never;

beforeEach(() => {
  streamChatResponse.mockReset();
});

describe("session controller", () => {
  it("wraps one turn in started/completed events", async () => {
    streamChatResponse.mockResolvedValue("answer");
    const { events, onEvent } = eventsOf();

    const response = await runAgentTurn({
      chatHistory: [],
      model,
      llmApi,
      sessionId: "session-1",
      turnId: "turn-1",
      onEvent,
    });

    expect(response).toBe("answer");
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.completed",
    ]);
    expect(events[0]).toMatchObject({
      sessionId: "session-1",
      turnId: "turn-1",
      seq: 1,
    });
    expect(events[1]).toMatchObject({ content: "answer", seq: 2 });
  });

  it("reports a failed turn and rethrows", async () => {
    streamChatResponse.mockRejectedValue(new Error("provider down"));
    const { events, onEvent } = eventsOf();

    await expect(
      runAgentTurn({ chatHistory: [], model, llmApi, onEvent }),
    ).rejects.toThrow("provider down");

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.failed",
    ]);
    expect(events[1]).toMatchObject({ message: "provider down" });
  });

  it("reports an interrupt when the handle aborts", async () => {
    streamChatResponse.mockImplementation(
      (...args: unknown[]) =>
        new Promise<string>((resolve) => {
          const controller = args[3] as AbortController;
          controller.signal.addEventListener("abort", () => resolve("partial"));
        }),
    );
    const { events, onEvent } = eventsOf();
    const handle = startAgentTurn({
      chatHistory: [],
      model,
      llmApi,
      onEvent,
    });

    handle.interrupt();
    await handle.done;

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "turn.interrupted",
    ]);
    expect(events[1]).toMatchObject({ reason: "user_abort" });
  });

  it("keeps one turn id and one sequence per run", async () => {
    streamChatResponse.mockResolvedValue("ok");
    const first = eventsOf();
    const second = eventsOf();

    await runAgentTurn({
      chatHistory: [],
      model,
      llmApi,
      onEvent: first.onEvent,
    });
    await runAgentTurn({
      chatHistory: [],
      model,
      llmApi,
      onEvent: second.onEvent,
    });

    expect(first.events[0].turnId).not.toBe(second.events[0].turnId);
    expect(first.events[1].seq).toBe(2);
    expect(second.events[1].seq).toBe(2);
  });
});
