import { describe, expect, it, vi } from "vitest";

vi.mock("./console.js", () => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock("./logger.js", () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import {
  MAX_RETRY_AFTER_MS,
  chatCompletionStreamWithBackoff,
  retryAfterMs,
} from "./exponentialBackoff.js";

/**
 * A 429 usually means the window is still full, and the provider says for how
 * long. Retrying on the client's own schedule spends the attempt on the same
 * refusal, so the header wins when it is there - and only a value that can be
 * read wins: anything else falls back to the computed delay.
 */
describe("Retry-After", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");

  it("reads seconds, which is the usual form", () => {
    expect(retryAfterMs({ headers: { "retry-after": "2" } }, now)).toBe(2000);
    expect(retryAfterMs({ headers: { "Retry-After": " 30 " } }, now)).toBe(
      30000,
    );
    expect(retryAfterMs({ headers: { "retry-after": "0" } }, now)).toBe(0);
  });

  it("reads an HTTP date, as the other form", () => {
    expect(
      retryAfterMs(
        {
          headers: new Headers({
            "retry-after": "Thu, 15 Oct 2026 12:00:03 GMT",
          }),
        },
        now,
      ),
    ).toBe(3000);
    // A date already past means the wait is over.
    expect(
      retryAfterMs(
        { headers: { "retry-after": "Thu, 15 Oct 2026 11:59:00 GMT" } },
        now,
      ),
    ).toBe(0);
  });

  it("ignores a value it cannot read, rather than guessing", () => {
    expect(
      retryAfterMs({ headers: { "retry-after": "soon" } }, now),
    ).toBeUndefined();
    expect(
      retryAfterMs({ headers: { "retry-after": "1.5" } }, now),
    ).toBeUndefined();
    expect(retryAfterMs({ headers: {} }, now)).toBeUndefined();
    expect(retryAfterMs({}, now)).toBeUndefined();
    expect(retryAfterMs(undefined, now)).toBeUndefined();
  });

  it("caps an absurd wait instead of obeying it", () => {
    expect(retryAfterMs({ headers: { "retry-after": "86400" } }, now)).toBe(
      MAX_RETRY_AFTER_MS,
    );
  });

  it("waits as long as the provider asked, not as long as the backoff would", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const api = {
        chatCompletionStream: vi.fn(() => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error("rate limited"), {
              status: 429,
              headers: { "retry-after": "2" },
            });
          }
          return (async function* () {
            yield "answer";
          })();
        }),
      } as any;

      const promise = chatCompletionStreamWithBackoff(
        api,
        { model: "gpt-4o", messages: [], stream: true } as any,
        new AbortController().signal,
        { maxRetries: 2, initialDelay: 1000, jitter: false, hiddenRetries: 99 },
      );

      // The computed delay here is 1s; the header said 2s.
      await vi.advanceTimersByTimeAsync(1500);
      expect(api.chatCompletionStream).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(600);
      const stream = await promise;
      expect(api.chatCompletionStream).toHaveBeenCalledTimes(2);

      const chunks: unknown[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(chunks).toEqual(["answer"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the computed delay when there is no header", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const api = {
        chatCompletionStream: vi.fn(() => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error("rate limited"), { status: 429 });
          }
          return (async function* () {})();
        }),
      } as any;

      const promise = chatCompletionStreamWithBackoff(
        api,
        { model: "gpt-4o", messages: [], stream: true } as any,
        new AbortController().signal,
        { maxRetries: 2, initialDelay: 1000, jitter: false, hiddenRetries: 99 },
      );

      await vi.advanceTimersByTimeAsync(1100);
      await promise;
      expect(api.chatCompletionStream).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
