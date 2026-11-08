import { render } from "ink-testing-library";
import { act } from "react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import {
  LoadingAnimation,
  prefersReducedMotion,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
} from "./LoadingAnimation.js";

function frameOf(element: React.ReactElement): string {
  const tree = render(element);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.TNT_REDUCED_MOTION;
});

describe("LoadingAnimation", () => {
  it("draws a single glyph rather than a cluster", () => {
    const frame = frameOf(<LoadingAnimation />);

    expect(frame).toBe(SPINNER_FRAMES[0]);
    expect([...frame]).toHaveLength(1);
  });

  it("draws nothing when hidden", () => {
    expect(frameOf(<LoadingAnimation visible={false} />)).toBe("");
  });

  it("uses Claude Code's six-frame set", () => {
    expect(SPINNER_FRAMES).toEqual(["·", "✢", "✱", "✶", "✻", "✽"]);
    expect(new Set(SPINNER_FRAMES).size).toBe(SPINNER_FRAMES.length);
    for (const frame of SPINNER_FRAMES) {
      expect([...frame]).toHaveLength(1);
    }
  });

  it("advances one frame per interval and wraps", async () => {
    vi.useFakeTimers();
    let tree!: ReturnType<typeof render>;
    await act(async () => {
      tree = render(<LoadingAnimation />);
    });

    try {
      expect(tree.lastFrame()).toBe(SPINNER_FRAMES[0]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS);
      });
      expect(tree.lastFrame()).toBe(SPINNER_FRAMES[1]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS * 5);
      });
      expect(tree.lastFrame()).toBe(SPINNER_FRAMES[0]);
    } finally {
      await act(async () => {
        tree.unmount();
      });
    }
  });

  it("holds a static frame under reduced motion", async () => {
    process.env.TNT_REDUCED_MOTION = "1";
    vi.useFakeTimers();
    let tree!: ReturnType<typeof render>;
    await act(async () => {
      tree = render(<LoadingAnimation />);
    });

    try {
      expect(tree.lastFrame()).toBe(SPINNER_FRAMES[0]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS * 6);
      });
      expect(tree.lastFrame()).toBe(SPINNER_FRAMES[0]);
    } finally {
      await act(async () => {
        tree.unmount();
      });
    }
  });

  it("parses the reduced-motion switch from the environment", () => {
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion({ TNT_REDUCED_MOTION: "1" })).toBe(true);
    expect(prefersReducedMotion({ TNT_REDUCED_MOTION: "TRUE" })).toBe(true);
    expect(prefersReducedMotion({ TNT_REDUCED_MOTION: "yes" })).toBe(true);
    expect(prefersReducedMotion({ TNT_REDUCED_MOTION: "0" })).toBe(false);
  });
});
