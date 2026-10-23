import { describe, expect, it } from "vitest";

import { WheelScrollAccelerator } from "./wheelScroll.js";

describe("WheelScrollAccelerator", () => {
  it("moves a fixed number of rows per event", () => {
    const wheel = new WheelScrollAccelerator(3, true);

    expect(wheel.next(1, 0)).toBe(3);
    expect(wheel.next(1, 1)).toBe(3);
  });

  it("keeps one row per notch when the terminal accelerates the wheel", () => {
    const wheel = new WheelScrollAccelerator("auto", false);

    expect(wheel.next(1, 0)).toBe(1);
    expect(wheel.next(1, 20)).toBe(1);
    expect(wheel.next(1, 40)).toBe(1);
  });

  it("moves one row for an isolated notch and accelerates a fast spin", () => {
    const wheel = new WheelScrollAccelerator("auto", true);

    expect(wheel.next(1, 0)).toBe(1);
    // A 100 ms gap maps to one row, so a deliberate notch stays precise.
    expect(wheel.next(1, 100)).toBe(1);

    let fast = 0;
    for (let time = 120; time <= 200; time += 20) {
      fast = wheel.next(1, time);
    }
    expect(fast).toBeGreaterThan(1);

    // A pause ends the gesture, so the next notch is precise again.
    expect(wheel.next(1, 1_200)).toBe(1);
  });

  it("does not accelerate a burst from one physical notch", () => {
    const wheel = new WheelScrollAccelerator("auto", true);

    expect(wheel.next(1, 0)).toBe(1);
    expect(wheel.next(1, 4)).toBe(1);
    expect(wheel.next(1, 8)).toBe(1);
  });

  it("resets acceleration when the direction changes", () => {
    const wheel = new WheelScrollAccelerator("auto", true);

    wheel.next(1, 0);
    expect(wheel.next(1, 20)).toBeGreaterThan(1);
    expect(wheel.next(-1, 40)).toBe(1);
  });

  it("caps the accelerated rows so one event cannot jump a screen", () => {
    const wheel = new WheelScrollAccelerator("auto", true);

    wheel.next(1, 0);
    for (let index = 1; index <= 20; index++) {
      expect(wheel.next(1, index * 6)).toBeLessThanOrEqual(6);
    }
  });
});
