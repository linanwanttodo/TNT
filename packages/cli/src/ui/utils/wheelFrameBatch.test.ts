import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WheelFrameBatch } from "./wheelFrameBatch.js";

describe("WheelFrameBatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies one burst of events as a single net delta", () => {
    const applied: number[] = [];
    const batch = new WheelFrameBatch((rows) => applied.push(rows));

    batch.add(-3);
    batch.add(-4);
    batch.add(-2);
    vi.advanceTimersByTime(20);

    expect(applied).toEqual([-9]);
  });

  it("starts a new frame after the window closes", () => {
    const applied: number[] = [];
    const batch = new WheelFrameBatch((rows) => applied.push(rows));

    batch.add(-3);
    vi.advanceTimersByTime(20);
    batch.add(5);
    vi.advanceTimersByTime(20);

    expect(applied).toEqual([-3, 5]);
  });

  it("ignores zero and non-finite deltas", () => {
    const applied: number[] = [];
    const batch = new WheelFrameBatch((rows) => applied.push(rows));

    batch.add(0);
    batch.add(Number.NaN);
    vi.advanceTimersByTime(20);

    expect(applied).toEqual([]);
  });

  it("flush() applies immediately and keeps later events batching", () => {
    const applied: number[] = [];
    const batch = new WheelFrameBatch((rows) => applied.push(rows));

    batch.add(-2);
    batch.flush();
    expect(applied).toEqual([-2]);

    batch.add(1);
    batch.dispose();
    vi.advanceTimersByTime(40);
    expect(applied).toEqual([-2]);
  });

  it("dispose drops the pending delta", () => {
    const applied: number[] = [];
    const batch = new WheelFrameBatch((rows) => applied.push(rows));

    batch.add(7);
    batch.dispose();
    vi.advanceTimersByTime(40);

    expect(applied).toEqual([]);
  });
});
