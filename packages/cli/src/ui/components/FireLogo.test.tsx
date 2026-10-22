import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FireLogo, supportsFireBanner } from "./FireLogo.js";

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 60, rows: 30, isResizing: false }),
}));

const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
};

describe("FireLogo", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back to the static wordmark without a capable terminal", () => {
    const tree = render(<FireLogo />);
    try {
      const frame = tree.lastFrame() ?? "";
      // The fallback is the two-line half-block wordmark, not the fire grid.
      expect(frame).toContain("▀██▀");
      expect(frame).not.toContain("▀".repeat(20));
    } finally {
      tree.unmount();
    }
  });

  it("draws the burning letters as two-pixel block cells", () => {
    const tree = render(<FireLogo animated rng={seeded(3)} />);
    try {
      const frame = tree.lastFrame() ?? "";
      const blockLines = frame.split("\n").filter((line) => line.includes("▀"));
      // Eight rows of pixels; the top row may still be cold on the first
      // frame because the fire starts at the letters and climbs.
      expect(blockLines.length).toBeGreaterThanOrEqual(6);
      expect(frame).toContain("▀▀▀▀");
    } finally {
      tree.unmount();
    }
  });

  it("runs on a frame interval and clears it on unmount", () => {
    const set = vi.spyOn(global, "setInterval");
    const clear = vi.spyOn(global, "clearInterval");
    const tree = render(<FireLogo animated rng={seeded(11)} />);
    try {
      expect(set).toHaveBeenCalledWith(expect.any(Function), 80);
      tree.unmount();
      expect(clear).toHaveBeenCalled();
    } finally {
      // unmounted above
    }
  });

  it("declares its capability gate", () => {
    const tty = { isTTY: true } as unknown as typeof process.stdout;
    const pipe = { isTTY: false } as unknown as typeof process.stdout;
    expect(supportsFireBanner(60, tty, {})).toBe(true);
    expect(supportsFireBanner(40, tty, {})).toBe(false);
    expect(supportsFireBanner(60, pipe, {})).toBe(false);
    expect(supportsFireBanner(60, tty, { NO_COLOR: "1" })).toBe(false);
  });
});
