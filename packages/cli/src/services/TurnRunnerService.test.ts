import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";

import { messageQueue, type QueuedMessage } from "../stream/messageQueue.js";

import { TurnRunnerService, type RunTurn } from "./TurnRunnerService.js";

// Short intervals so idle loops expire quickly between tests.
const fastOptions = { pollIntervalMs: 5, idleTimeoutMs: 50 };

const liveRunners: TurnRunnerService[] = [];

function createRunner() {
  const runner = new TurnRunnerService(fastOptions);
  liveRunners.push(runner);
  return runner;
}

afterEach(async () => {
  messageQueue.clearMessages();
  for (const runner of liveRunners) {
    await vi.waitFor(() => expect(runner.isRunning()).toBe(false));
  }
  liveRunners.length = 0;
});

describe("TurnRunnerService", () => {
  it("drains an enqueued message when the runner is idle", async () => {
    const runner = createRunner();
    await messageQueue.enqueueMessage("first prompt");

    const runTurn: MockedFunction<RunTurn> = vi.fn(
      async (_message: QueuedMessage, _signal: AbortSignal) => {},
    );
    runner.startDraining(runTurn);

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    const [queued, signal] = runTurn.mock.calls[0];
    expect(queued.message).toBe("first prompt");
    expect(signal instanceof AbortSignal).toBe(true);
  });

  it("keeps draining messages enqueued during a running turn", async () => {
    const runner = createRunner();
    let releaseFirst: () => void = () => {};
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    await messageQueue.enqueueMessage("first prompt");
    const runTurn: MockedFunction<RunTurn> = vi
      .fn()
      .mockImplementationOnce(() => firstTurn)
      .mockResolvedValue(undefined);
    runner.startDraining(runTurn);

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    await messageQueue.enqueueMessage("second prompt");
    releaseFirst();

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(runTurn.mock.calls[1][0].message).toBe("second prompt");
    expect(runner.isRunning()).toBe(true);
  });

  it("requestStop aborts the running turn and the runner goes idle", async () => {
    const runner = createRunner();
    let observedAborted: boolean | undefined;
    const runTurn: RunTurn = vi.fn(
      (_message: QueuedMessage, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            observedAborted = signal.aborted;
            reject(new Error("aborted"));
          });
        }),
    );

    await messageQueue.enqueueMessage("stoppable prompt");
    runner.startDraining(runTurn);
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));

    runner.requestStop();

    expect(observedAborted).toBe(true);
    await vi.waitFor(() => expect(runner.isRunning()).toBe(false));
  });

  it("requestStop is a no-op when no turn is running", () => {
    const runner = createRunner();
    expect(() => runner.requestStop()).not.toThrow();
    expect(runner.isRunning()).toBe(false);
  });

  it("startDraining is idempotent while a loop is live", async () => {
    const runner = createRunner();
    await messageQueue.enqueueMessage("only prompt");
    const runTurn: MockedFunction<RunTurn> = vi.fn(
      async (_message: QueuedMessage, _signal: AbortSignal) => {},
    );

    runner.startDraining(runTurn);
    runner.startDraining(runTurn);
    runner.startDraining(runTurn);

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    expect(runner.isRunning()).toBe(true);

    await messageQueue.enqueueMessage("follow-up");
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    expect(runTurn.mock.calls.map(([message]) => message.message)).toEqual([
      "only prompt",
      "follow-up",
    ]);
  });
});
