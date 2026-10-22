import { describe, expect, it } from "vitest";

import {
  FIRE_ROWS,
  buildFireMask,
  createFireGrid,
  fireColor,
  fireHex,
  stepFire,
} from "./fireLogo.js";

const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
};

describe("the fire banner engine", () => {
  it("draws the letters into the lower half of the grid", () => {
    const mask = buildFireMask(FIRE_ROWS, 44);

    // Three glyph clusters, bottom-aligned with two empty rows above.
    const litRows = mask.map((row) => row.filter(Boolean).length);
    expect(litRows[FIRE_ROWS - 1]).toBeGreaterThan(0);
    expect(litRows[FIRE_ROWS - 1]).toBe(litRows[FIRE_ROWS - 2]);
    expect(mask[0].every((cell) => !cell)).toBe(true);
    expect(mask[1].every((cell) => !cell)).toBe(true);

    const topRowLit = mask[3].filter(Boolean).length;
    // Both T bars (10 px each) plus the N's two stem tips (2 px each).
    expect(topRowLit).toBe(10 + 4 + 10);
  });

  it("keeps every palette step warm - red outranks blue", () => {
    const steps = [0.1, 0.3, 0.5, 0.7, 0.9, 0.99].map(fireColor);
    for (const [r, , b] of steps) {
      expect(r).toBeGreaterThan(b);
    }
    expect(steps[0][0]).toBeLessThan(steps[4][0]);
    expect(fireColor(0)).toEqual([0, 0, 0]);
    expect(fireHex(0)).toBe("#000000");
    expect(fireHex(0.99)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("steps deterministically for a seeded rng and keeps letters hot", () => {
    const mask = buildFireMask(FIRE_ROWS, 44);
    const a = createFireGrid(mask, seeded(7));
    const b = createFireGrid(mask, seeded(7));
    expect(a).toEqual(b);

    const nextA = stepFire(a, mask, seeded(9));
    const nextB = stepFire(a, mask, seeded(9));
    expect(nextA).toEqual(nextB);
    // The fire moves: successive frames are not identical.
    expect(nextA).not.toEqual(a);

    for (let y = 0; y < FIRE_ROWS; y += 1) {
      for (let x = 0; x < 44; x += 1) {
        if (mask[y][x]) expect(nextA[y][x]).toBeGreaterThanOrEqual(0.6);
      }
    }
  });
});
