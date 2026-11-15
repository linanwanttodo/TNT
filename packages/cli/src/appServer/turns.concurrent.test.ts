import { describe, expect, it, vi } from "vitest";

import { SessionRuntimeStore } from "./runtime.js";
import { TurnHandlers } from "./turns.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  return {
    runtimes: new SessionRuntimeStore(),
    sender: { send: vi.fn().mockResolvedValue(undefined) } as never,
    events: { subscribe: vi.fn().mockReturnValue(() => undefined) } as never,
  };
}

function makeHandlers(
  options: Record<string, unknown>,
  executor: unknown,
): TurnHandlers {
  const { runtimes, sender, events } = harness();
  const handlers = new TurnHandlers({
    sender,
    runtimes,
    events,
    executor,
    ensureServices: async () => undefined,
    ...options,
  } as never);
  // The store requires a live session record; these tests exercise dispatch,
  // so a stub is enough and keeps the fixture independent of disk state.
  vi.spyOn(handlers as never, "requireSession").mockReturnValue({} as never);
  return handlers;
}

describe("concurrent session turns", () => {
  it("runs two sessions in parallel and keeps one session serial", async () => {
    const gates = [deferred(), deferred(), deferred()];
    const started: string[] = [];
    const signals: AbortSignal[] = [];
    let call = 0;
    const executor = vi.fn(
      async (turn: { sessionId: string }, signal: AbortSignal) => {
        const index = call++;
        started.push(`${turn.sessionId}#${index}`);
        signals.push(signal);
        await gates[index].promise;
      },
    );
    const handlers = makeHandlers(
      {
        concurrentSessions: true,
        acceptRemoteText: async () => false,
      },
      executor,
    );

    await handlers.sendText("a", "first A");
    await handlers.sendText("b", "first B");
    await handlers.sendText("a", "second A");

    // The chain is scheduled on a microtask; let both starts land.
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["a#0", "b#1"]);
    expect(handlers.isRunning("a")).toBe(true);
    expect(handlers.isRunning("b")).toBe(true);
    expect(handlers.isRunning("c")).toBe(false);

    // Stop B must not interrupt A.
    await handlers.stopSession("b");
    expect(signals[1].aborted).toBe(true);
    expect(signals[0].aborted).toBe(false);

    gates[0].resolve();
    gates[1].resolve();
    // The per-session chain settles across several microtasks; wait for the
    // queued follow-up to start instead of guessing the tick count.
    await vi.waitFor(() => expect(started).toContain("a#2"), {
      timeout: 1000,
      interval: 5,
    });

    gates[2].resolve();
    await handlers.stopSession("a");
    handlers.dispose();
  });

  it("keeps the legacy single pump path when concurrency is off", async () => {
    const pump = {
      startDraining: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
      requestStop: vi.fn(),
    };
    const executor = vi.fn().mockResolvedValue(undefined);
    const handlers = makeHandlers(
      {
        concurrentSessions: false,
        pump,
        queue: {
          enqueueMessage: vi.fn().mockResolvedValue(true),
          on: vi.fn(),
          off: vi.fn(),
        },
      },
      executor,
    );

    await handlers.sendText("solo", "text");
    expect(pump.startDraining).toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    handlers.dispose();
  });
});
