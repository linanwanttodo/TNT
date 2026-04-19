import { describe, expect, it } from "vitest";

import {
  REVEAL_MAX_CHARS,
  REVEAL_TICK_MS,
  nextRevealLength,
  revealEnabled,
} from "./streamReveal.js";

describe("the streaming reveal", () => {
  it("is off unless asked for", () => {
    expect(revealEnabled({})).toBe(false);
    expect(revealEnabled({ TNT_STREAM_REVEAL: "0" })).toBe(false);
    expect(revealEnabled({ TNT_STREAM_REVEAL: "1" })).toBe(true);
  });

  it("shows everything already available and never overshoots", () => {
    expect(nextRevealLength(10, 10, 100)).toBe(10);
    expect(nextRevealLength(10, 4, 100)).toBe(4);
    expect(nextRevealLength(0, 5, REVEAL_TICK_MS)).toBeLessThanOrEqual(5);
    // A long gap between ticks must not run past what has arrived.
    expect(nextRevealLength(0, 5, 10_000)).toBe(5);
  });

  it("catches up faster the further the model is ahead", () => {
    const oneTick = nextRevealLength(0, 200, REVEAL_TICK_MS);
    const threeTicks = nextRevealLength(0, 200, REVEAL_TICK_MS * 3);

    expect(oneTick).toBeGreaterThan(1);
    expect(threeTicks).toBeGreaterThan(oneTick);
    expect(threeTicks).toBeLessThanOrEqual(200);
  });

  it("keeps the per-frame slice bounded", () => {
    // The cap exists so a long answer does not get sliced and redrawn per tick.
    expect(REVEAL_MAX_CHARS).toBeLessThanOrEqual(20_000);
  });
});
