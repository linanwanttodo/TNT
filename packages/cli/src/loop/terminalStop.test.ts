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
