import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TurnRunnerService,
  type RunTurn,
} from "../../services/TurnRunnerService.js";
import { messageQueue, type QueuedMessage } from "../../stream/messageQueue.js";

import { runOneTurn } from "./useChat.js";

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

/**
 * The queue-drain seam between the TUI and the shared turn runner: the hook
 * hands `runOneTurn` to the drain loop, and the loop delivers each queued
 * message to it one at a time. These tests pin what the callback does with
 * the message it receives; the loop's own ordering lives in
 * TurnRunnerService.test.ts.
 */
describe("useChat queue drain seam", () => {
  it("processes the queued message the runner dequeues", async () => {
    const runner = createRunner();
    const processQueuedMessage = vi.fn(
      async (_message: string, _imageMap?: Map<string, Buffer>) => {},
    );
    await messageQueue.enqueueMessage("follow-up prompt");

    runner.startDraining((message, signal) =>
      runOneTurn(message, signal, processQueuedMessage),
    );

    await vi.waitFor(() =>
      expect(processQueuedMessage).toHaveBeenCalledTimes(1),
    );
    const [text, imageMap] = processQueuedMessage.mock.calls[0];
    expect(text).toBe("follow-up prompt");
    expect(imageMap).toBeUndefined();
  });

  it("passes the queued image map through to processing", async () => {
    const runner = createRunner();
    const processQueuedMessage = vi.fn(
      async (_message: string, _imageMap?: Map<string, Buffer>) => {},
    );
    const imageMap = new Map<string, Buffer>([["img", Buffer.from("png")]]);
    await messageQueue.enqueueMessage("with image", imageMap);

    runner.startDraining((message, signal) =>
      runOneTurn(message, signal, processQueuedMessage),
    );

    await vi.waitFor(() =>
      expect(processQueuedMessage).toHaveBeenCalledTimes(1),
    );
    expect(processQueuedMessage.mock.calls[0][1]).toBe(imageMap);
  });

  it("starts only one drain loop at a time", async () => {
    const runner = createRunner();
    const processQueuedMessage = vi.fn(
      async (_message: string, _imageMap?: Map<string, Buffer>) => {},
    );
    const lateRunTurn: RunTurn = vi.fn(async () => {});
    await messageQueue.enqueueMessage("first prompt");

    runner.startDraining((message, signal) =>
      runOneTurn(message, signal, processQueuedMessage),
    );
    runner.startDraining(lateRunTurn);

    await vi.waitFor(() =>
      expect(processQueuedMessage).toHaveBeenCalledTimes(1),
    );
    expect(lateRunTurn).not.toHaveBeenCalled();

    await messageQueue.enqueueMessage("second prompt");
    await vi.waitFor(() =>
      expect(processQueuedMessage).toHaveBeenCalledTimes(2),
    );
    expect(lateRunTurn).not.toHaveBeenCalled();
    expect(processQueuedMessage.mock.calls.map(([text]) => text)).toEqual([
      "first prompt",
      "second prompt",
    ]);
  });

  it("skips a queued message whose turn was stopped before it started", async () => {
    const controller = new AbortController();
    controller.abort();
    const processQueuedMessage = vi.fn(
      async (_message: string, _imageMap?: Map<string, Buffer>) => {},
    );
    const queued: QueuedMessage = {
      id: "queued-1",
      message: "doomed prompt",
      timestamp: Date.now(),
    };

    await runOneTurn(queued, controller.signal, processQueuedMessage);

    expect(processQueuedMessage).not.toHaveBeenCalled();
  });
});
