import { vi } from "vitest";

import { createMinimalTestContext } from "../../test-utils/ui-test-context.js";
import { classifyStreamError } from "../loop/terminalStop.js";

import {
  isRetryableError,
  streamIdleTimeoutMs,
  withExponentialBackoff,
} from "./exponentialBackoff.js";

describe("withExponentialBackoff", () => {
  let context: any;
  let abortController: AbortController;

  beforeEach(() => {
    context = createMinimalTestContext();
    abortController = new AbortController();
    vi.clearAllMocks();
  });

  afterEach(() => {
    context.cleanup();
  });

  it("should successfully yield all values from generator", async () => {
    const mockData = ["chunk1", "chunk2", "chunk3"];
    const generatorFactory = vi.fn(async (retryAbortSignal: AbortSignal) => {
      return (async function* () {
        for (const chunk of mockData) {
          yield chunk;
        }
      })();
    });

    const results: string[] = [];
    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
    );

    for await (const chunk of generator) {
      results.push(chunk);
    }

    expect(results).toEqual(mockData);
    expect(generatorFactory).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable errors during generator creation", async () => {
    let callCount = 0;
    const generatorFactory = vi.fn(async (retryAbortSignal: AbortSignal) => {
      callCount++;
      if (callCount === 1) {
        const error = new Error("Connection reset");
        (error as any).code = "ECONNRESET";
        throw error;
      }
      return (async function* () {
        yield "success";
      })();
    });

    const results: string[] = [];
    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
      {
        maxRetries: 2,
        initialDelay: 10, // Short delay for testing
      },
    );

    for await (const chunk of generator) {
      results.push(chunk);
    }

    expect(results).toEqual(["success"]);
    expect(generatorFactory).toHaveBeenCalledTimes(2);
  });

  it("should not retry a retryable error after yielding a chunk", async () => {
    let callCount = 0;
    const generatorFactory = vi.fn(async () => {
      callCount++;
      return (async function* () {
        yield "partial";
        const error = new Error("Connection reset");
        (error as any).code = "ECONNRESET";
        throw error;
      })();
    });
    const results: string[] = [];
    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
      { maxRetries: 2, initialDelay: 0 },
    );

    await expect(async () => {
      for await (const chunk of generator) {
        results.push(chunk);
      }
    }).rejects.toThrow("Connection reset");

    expect(results).toEqual(["partial"]);
    expect(generatorFactory).toHaveBeenCalledTimes(1);
  });

  it("should not retry on non-retryable errors", async () => {
    const generatorFactory = vi.fn(async (retryAbortSignal: AbortSignal) => {
      const error = new Error("Bad request");
      (error as any).status = 400;
      throw error;
    });

    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
    );

    await expect(async () => {
      for await (const chunk of generator) {
        // Should not reach here
      }
    }).rejects.toThrow("Bad request");

    expect(generatorFactory).toHaveBeenCalledTimes(1);
  });

  it("should handle abort signal", async () => {
    const generatorFactory = vi.fn(async (retryAbortSignal: AbortSignal) => {
      return (async function* () {
        yield "should-not-yield";
      })();
    });

    // Abort immediately
    abortController.abort();

    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
    );

    await expect(async () => {
      for await (const chunk of generator) {
        // Should not reach here
      }
    }).rejects.toThrow("Request aborted");

    expect(generatorFactory).toHaveBeenCalledTimes(0);
  });
});

/**
 * A provider that accepts the request and then stops sending throws nothing,
 * so nothing above this file's retry loop can see the break: the wait for the
 * next chunk simply never returns, the turn never ends and every later message
 * is queued behind it. The idle bound is what turns that into a failure the
 * loop can name, retry and report.
 */
describe("the stream idle bound", () => {
  let context: any;
  let abortController: AbortController;

  beforeEach(() => {
    context = createMinimalTestContext();
    abortController = new AbortController();
  });

  afterEach(() => {
    context.cleanup();
  });

  /** A stream that goes quiet forever after `chunksBeforeStall` chunks. */
  function stallingGenerator(chunksBeforeStall = 0) {
    let closed = false;
    return {
      build: async () =>
        (async function* () {
          try {
            for (let index = 0; index < chunksBeforeStall; index += 1) {
              yield `chunk-${index}`;
            }
            await new Promise(() => {});
          } finally {
            closed = true;
          }
        })(),
      isClosed: () => closed,
    };
  }

  it("cuts a stream that never sends and retries the request", async () => {
    const stall = stallingGenerator(0);
    const generatorFactory = vi.fn(async () => stall.build());

    const results: string[] = [];
    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
      { maxRetries: 1, initialDelay: 0, idleMs: 40 },
    );

    await expect(async () => {
      for await (const chunk of generator) {
        results.push(chunk);
      }
    }).rejects.toThrow(/stream stall/i);

    // Two attempts: the first stalled, the retry stalled too, and the stall is
    // what the caller is told - not a silent hang.
    expect(generatorFactory).toHaveBeenCalledTimes(2);
  });

  it("keeps the no-replay rule when the stall follows a chunk", async () => {
    const stall = stallingGenerator(1);
    const generatorFactory = vi.fn(async () => stall.build());

    const results: string[] = [];
    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
      { maxRetries: 2, initialDelay: 0, idleMs: 40 },
    );

    await expect(async () => {
      for await (const chunk of generator) {
        results.push(chunk);
      }
    }).rejects.toThrow(/stream stall/i);

    expect(results).toEqual(["chunk-0"]);
    expect(generatorFactory).toHaveBeenCalledTimes(1);
  });

  it("aborts the stalled attempt so its request is released", async () => {
    const stall = stallingGenerator(0);
    const signals: AbortSignal[] = [];
    const generatorFactory = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal);
      return stall.build();
    });

    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
      { maxRetries: 0, initialDelay: 0, idleMs: 40 },
    );

    await expect(async () => {
      for await (const chunk of generator) {
        // The stream never sends.
      }
    }).rejects.toThrow(/stream stall/i);

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
  });

  it("leaves a stream that keeps sending alone", async () => {
    const generatorFactory = vi.fn(async () =>
      (async function* () {
        for (let index = 0; index < 10; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          yield `chunk-${index}`;
        }
      })(),
    );

    const results: string[] = [];
    const generator = withExponentialBackoff(
      generatorFactory,
      abortController.signal,
      { idleMs: 500 },
    );

    for await (const chunk of generator) {
      results.push(chunk);
    }

    expect(results).toHaveLength(10);
    expect(generatorFactory).toHaveBeenCalledTimes(1);
  });

  it("reports the stall as the fault the loop already retries", async () => {
    const stall = stallingGenerator(0);
    let thrown: any;
    const generator = withExponentialBackoff(
      async () => stall.build(),
      abortController.signal,
      { maxRetries: 0, initialDelay: 0, idleMs: 40 },
    );

    try {
      for await (const chunk of generator) {
        // The stream never sends.
      }
    } catch (error) {
      thrown = error;
    }

    // The transport retry and the round retry are two different budgets, and a
    // new fault has to be visible to both or it ends the turn silently.
    expect(classifyStreamError(thrown)).toBe("stream_stall");
    expect(isRetryableError(thrown)).toBe(true);
  });

  it("is the documented budget, and a number the environment can set", () => {
    const read = (value?: string) =>
      streamIdleTimeoutMs(
        value === undefined ? {} : { TNT_STREAM_IDLE_TIMEOUT_MS: value },
      );

    expect(read()).toBe(120_000);
    expect(read("5000")).toBe(5_000);
    // Zero is an answer, not a missing value: it means no bound.
    expect(read("0")).toBe(0);
    expect(read("not a number")).toBe(120_000);
    expect(read("-5")).toBe(120_000);
  });
});
