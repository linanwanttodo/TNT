import { describe, expect, it } from "vitest";

import {
  FIRE_ROWS,
  fireGlyph,
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

    // Fourteen glyph rows sit at the bottom; the top of the grid is where
    // the flames rise.
    const firstLit = mask.findIndex((row) => row.some(Boolean));
    expect(firstLit).toBe(FIRE_ROWS - 14);
    expect(mask[0].every((cell) => !cell)).toBe(true);

    // Both T bars (10 px each) plus the N's two stem tips (2 px each).
    expect(mask[firstLit].filter(Boolean).length).toBe(10 + 4 + 10);
  });

  it("stays blood red and black - no gold, no blue", () => {
    const steps = [0.1, 0.3, 0.5, 0.7, 0.9, 0.99].map(fireColor);
    for (const [r, g, b] of steps) {
      expect(r).toBeGreaterThan(b);
      // Red channel dominates; green stays low so nothing turns orange/gold.
      expect(r).toBeGreaterThan(g * 1.5);
    }
    expect(steps[3][1]).toBeLessThan(80);
    expect(steps[0][0]).toBeLessThan(steps[4][0]);
    expect(fireColor(0)).toEqual([0, 0, 0]);
    expect(fireHex(0)).toBe("#000000");
    expect(fireHex(0.99)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("maps heat onto the ramp, darkest to brightest", () => {
    expect(fireGlyph(0)).toBe(" ");
    const ramp = " .:-=+*xX$&%@";
    const cool = ramp.indexOf(fireGlyph(0.2));
    const hot = ramp.indexOf(fireGlyph(0.95));
    expect(cool).toBeGreaterThan(0);
    expect(hot).toBeGreaterThan(cool);
    expect(fireGlyph(1)).toBe("@");
  });

  it("steps deterministically and keeps the glyph cells dark", () => {
    const mask = buildFireMask(FIRE_ROWS, 40);
    const a = createFireGrid(mask, seeded(7));
    const b = createFireGrid(mask, seeded(7));
    expect(a).toEqual(b);

    const nextA = stepFire(a, mask, seeded(9));
    const nextB = stepFire(a, mask, seeded(9));
    expect(nextA).toEqual(nextB);
    // The fire moves: successive frames are not identical.
    expect(nextA).not.toEqual(a);

    for (let y = 0; y < FIRE_ROWS; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        // The letters are a black silhouette: no fire inside them.
        if (mask[y][x]) expect(nextA[y][x]).toBe(0);
      }
    }
    // The field is sparse, not a solid block: plenty of cells stay cold.
    const lit = nextA.flat().filter((v) => v > 0.05).length;
    expect(lit).toBeLessThan(FIRE_ROWS * 40 * 0.7);
  });
});
