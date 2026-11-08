import { render } from "ink-testing-library";
import { act } from "react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import {
  ActionStatus,
  isOutputStalled,
  SHOW_TOKEN_COUNT_AFTER_MS,
  shouldShowTokenCount,
  STALL_THRESHOLD_MS,
  statusColors,
} from "./ActionStatus.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

/**
 * Every call site passes a translated constant today, so nothing here is a
 * live hole: this is the boundary held shut in case a status ever carries
 * text from outside the process.
 */
describe("ActionStatus terminal safety", () => {
  it("does not pass a control sequence from the status message through", () => {
    const frame = frameOf(
      <ActionStatus
        visible
        startTime={Date.now()}
        message={`working${ESC}]0;pwned${BEL} on`}
      />,
    );

    expect(frame).not.toContain(`${ESC}]0;`);
    expect(frame).toContain("working");
    expect(frame).toContain("on");
  });

  it("does not pass a control sequence from the extra hint through", () => {
    const frame = frameOf(
      <ActionStatus
        visible
        startTime={Date.now()}
        message="working"
        additionalHint={`hint${ESC}]2;evil${BEL} tail`}
      />,
    );

    expect(frame).not.toContain(`${ESC}]2;`);
    expect(frame).toContain("tail");
  });
});

describe("ActionStatus token gating", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the counter hidden for a short turn", () => {
    expect(shouldShowTokenCount({ elapsedMs: 1_000, tokenCount: 40 })).toBe(
      false,
    );
    expect(
      shouldShowTokenCount({
        elapsedMs: SHOW_TOKEN_COUNT_AFTER_MS - 1,
        tokenCount: 40,
      }),
    ).toBe(false);
  });

  it("shows the counter once the 30 second gate passes", () => {
    expect(
      shouldShowTokenCount({
        elapsedMs: SHOW_TOKEN_COUNT_AFTER_MS,
        tokenCount: 40,
      }),
    ).toBe(true);
  });

  it("lets verbose output skip the gate", () => {
    expect(
      shouldShowTokenCount({ elapsedMs: 0, tokenCount: 40, verbose: true }),
    ).toBe(true);
  });

  it("never shows a counter with no tokens behind it", () => {
    expect(shouldShowTokenCount({ elapsedMs: 60_000, tokenCount: 0 })).toBe(
      false,
    );
    expect(shouldShowTokenCount({ elapsedMs: 60_000 })).toBe(false);
  });

  it("reveals the counter when the clock crosses the gate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
    const startTime = Date.now();
    let tree!: ReturnType<typeof render>;
    await act(async () => {
      tree = render(
        <ActionStatus
          visible
          startTime={startTime}
          message="Thinking"
          tokenCount={400}
        />,
      );
    });

    try {
      expect(tree.lastFrame() ?? "").not.toContain("tokens");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHOW_TOKEN_COUNT_AFTER_MS + 600);
      });

      expect(tree.lastFrame() ?? "").toContain("↓ 400 tokens");
    } finally {
      await act(async () => {
        tree.unmount();
      });
    }
  });

  it("shows the counter immediately in verbose mode", () => {
    const frame = frameOf(
      <ActionStatus
        visible
        startTime={Date.now()}
        message="Thinking"
        tokenCount={123}
        verbose
      />,
    );

    expect(frame).toContain("↓ 123 tokens");
  });
});

describe("ActionStatus stall detection", () => {
  it("turns a stall on exactly at the threshold", () => {
    expect(
      isOutputStalled({
        now: STALL_THRESHOLD_MS - 1,
        lastOutputAt: 0,
        tokenCount: 40,
      }),
    ).toBe(false);
    expect(
      isOutputStalled({
        now: STALL_THRESHOLD_MS,
        lastOutputAt: 0,
        tokenCount: 40,
      }),
    ).toBe(true);
  });

  it("does not call a running tool a stall", () => {
    expect(
      isOutputStalled({
        now: 60_000,
        lastOutputAt: 0,
        tokenCount: 40,
        hasActiveTools: true,
      }),
    ).toBe(false);
  });

  it("has nothing to stall when the caller reports no output", () => {
    expect(isOutputStalled({ now: 60_000, lastOutputAt: 0 })).toBe(false);
  });

  it("paints the spinner and message red only while stalled", () => {
    expect(
      statusColors({
        stalled: true,
        messageColor: "dim",
        loadingColor: "gray",
      }),
    ).toEqual({ message: "red", spinner: "red" });
    expect(
      statusColors({
        stalled: false,
        messageColor: "dim",
        loadingColor: "gray",
      }),
    ).toEqual({ message: "dim", spinner: "gray" });
  });
});
