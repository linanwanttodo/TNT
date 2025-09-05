import { describe, expect, it } from "vitest";

import {
  classifyStreamError,
  isRetryableStop,
  MAX_RETRIES_PER_KIND,
  TerminalStopTracker,
} from "./terminalStop.js";

describe("classifyStreamError", () => {
  it("recognizes a stalled stream", () => {
    expect(classifyStreamError(new Error("Stream stall detected"))).toBe(
      "stream_stall",
    );
  });

  it("recognizes an http/2 stream reset", () => {
    expect(
      classifyStreamError(
        new Error("stream closed with error code NGHTTP2_INTERNAL_ERROR"),
      ),
    ).toBe("stream_stall");
    expect(classifyStreamError(new Error("HTTP2StreamResetError thrown"))).toBe(
      "stream_stall",
    );
  });

  it("recognizes a provider that omitted its terminal event", () => {
    expect(
      classifyStreamError(new Error("missing finish_reason in response")),
    ).toBe("missing_terminal_event");
    expect(
      classifyStreamError(new Error("expected terminal response event")),
    ).toBe("missing_terminal_event");
  });

  it("leaves an unrelated error unclassified", () => {
    expect(classifyStreamError(new Error("invalid api key"))).toBe("ok");
  });

  it("names a refusal for length as an overflow, whatever shape it arrives in", () => {
    expect(
      classifyStreamError(
        new Error("400 prompt is too long: 210000 tokens > 200000 maximum"),
      ),
    ).toBe("context_overflow");
    expect(
      classifyStreamError(
        new Error("This model's maximum context length is 8192 tokens"),
      ),
    ).toBe("context_overflow");
    expect(
      classifyStreamError(
        new Error("input length and `max_tokens` exceed context limit"),
      ),
    ).toBe("context_overflow");
    // Adapters do not agree on throwing an Error.
    expect(
      classifyStreamError({ message: "context_length_exceeded", status: 400 }),
    ).toBe("context_overflow");
    expect(
      classifyStreamError("tokens in the prompt exceeds the context window"),
    ).toBe("context_overflow");
  });

  it("reads a context refusal as a refusal when it also mentions a reset", () => {
    expect(
      classifyStreamError(
        new Error(
          "HTTP2StreamResetError thrown: maximum context length is 8192 tokens",
        ),
      ),
    ).toBe("context_overflow");
  });

  it("accepts a non-Error value", () => {
    expect(classifyStreamError("stream stall")).toBe("stream_stall");
  });
});

describe("isRetryableStop", () => {
  it("retries transport faults but not model decisions", () => {
    expect(isRetryableStop("stream_stall")).toBe(true);
    expect(isRetryableStop("missing_terminal_event")).toBe(true);
    expect(isRetryableStop("empty_response")).toBe(false);
    expect(isRetryableStop("malformed_tool_call")).toBe(false);
    // Resending the same bytes is the same refusal; the loop has to shrink first.
    expect(isRetryableStop("context_overflow")).toBe(false);
  });
});

describe("TerminalStopTracker", () => {
  it("allows a bounded number of retries per kind", () => {
    const tracker = new TerminalStopTracker();

    for (let i = 0; i < MAX_RETRIES_PER_KIND; i++) {
      expect(tracker.shouldRetry("stream_stall")).toBe(true);
    }
    expect(tracker.shouldRetry("stream_stall")).toBe(false);
    expect(tracker.exhaustedKind()).toBe("stream_stall");
  });

  it("keeps separate budgets per kind", () => {
    const tracker = new TerminalStopTracker();

    for (let i = 0; i < MAX_RETRIES_PER_KIND; i++) {
      tracker.shouldRetry("stream_stall");
    }
    // A different fault still has its own untouched budget.
    expect(tracker.shouldRetry("missing_terminal_event")).toBe(true);
  });

  it("never retries a kind that is not retryable", () => {
    const tracker = new TerminalStopTracker();
    expect(tracker.shouldRetry("malformed_tool_call")).toBe(false);
    expect(tracker.exhaustedKind()).toBeUndefined();
  });

  it("starts from zero on reset", () => {
    const tracker = new TerminalStopTracker();

    for (let i = 0; i < MAX_RETRIES_PER_KIND; i++) {
      tracker.shouldRetry("stream_stall");
    }
    tracker.resetForNewTurn();
    expect(tracker.retriesUsed("stream_stall")).toBe(0);
    expect(tracker.shouldRetry("stream_stall")).toBe(true);
  });
});
