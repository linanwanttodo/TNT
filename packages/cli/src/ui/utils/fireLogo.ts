/** Pixel-art fire banner: a shared intensity field stepped each frame. */
export type FireGrid = number[][];
export type Rng = () => number;

// 5x7 block font, doubled to 10x14 pixels per glyph.
const GLYPHS: Record<string, string[]> = {
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
};
const SCALE = 2;
const GAP = 2;
const TEXT = "TNT";

export const FIRE_ROWS = 16;
export const FIRE_MAX_COLS = 44;
export const FIRE_FRAME_MS = 80;

/** Cells of the T>N>T glyphs; the letters are the hot source of the fire. */
function paintGlyph(
  mask: boolean[][],
  glyph: string[],
  originX: number,
  originY: number,
): void {
  for (let gy = 0; gy < 7; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      if (glyph[gy][gx] !== "1") continue;
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          mask[originY + gy * SCALE + sy][originX + gx * SCALE + sx] = true;
        }
      }
    }
  }
}

export function buildFireMask(rows: number, cols: number): boolean[][] {
  const mask = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false),
  );

  const glyphHeight = 7 * SCALE;
  const textWidth = TEXT.length * 5 * SCALE + (TEXT.length - 1) * GAP * SCALE;
  if (cols < textWidth || rows < glyphHeight) return mask;

  const startX = Math.floor((cols - textWidth) / 2);
  const startY = rows - glyphHeight;

  let x = startX;
  for (const character of TEXT) {
    paintGlyph(mask, GLYPHS[character], x, startY);
    x += 5 * SCALE + GAP * SCALE;
  }
  return mask;
}

/**
 * Fire palette only: black -> deep red -> orange -> amber -> yellow -> white.
 * The red channel never loses to blue, which is what keeps the banner warm.
 */
export function fireColor(intensity: number): [number, number, number] {
  if (intensity <= 0.05) return [0, 0, 0];
  if (intensity < 0.2) return [90, 8, 0];
  if (intensity < 0.4) return [170, 30, 0];
  if (intensity < 0.6) return [240, 90, 0];
  if (intensity < 0.8) return [255, 160, 20];
  if (intensity < 0.93) return [255, 215, 60];
  return [255, 250, 200];
}

function emptyGrid(rows: number, cols: number): FireGrid {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0),
  );
}

/**
 * One upward step of the fire: the bottom row carries fresh embers, heat
 * drifts up with a random sideways step and decays, and the glyph mask keeps
 * its cells glowing so the letters always read through the flames.
 */
export function stepFire(
  previous: FireGrid,
  mask: boolean[][],
  rng: Rng,
): FireGrid {
  const rows = previous.length;
  const cols = previous[0].length;
  const next = emptyGrid(rows, cols);

  for (let x = 0; x < cols; x += 1) {
    next[rows - 1][x] = 0.5 + rng() * 0.5;
  }

  for (let y = rows - 2; y >= 0; y -= 1) {
    for (let x = 0; x < cols; x += 1) {
      const source = previous[y + 1][x];
      if (source <= 0.05) continue;
      const drift = Math.floor(rng() * 3) - 1;
      const target = Math.min(cols - 1, Math.max(0, x + drift));
      const decayed = Math.max(0, source - (0.03 + rng() * 0.12));
      next[y][target] = Math.max(next[y][target], decayed);
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (mask[y][x]) {
        next[y][x] = Math.max(next[y][x], 0.62 + rng() * 0.3);
      }
    }
  }

  return next;
}

/** The first frame: a cold grid with a warm bottom row and glowing letters. */
export function createFireGrid(
  mask: boolean[][],
  rng: Rng = Math.random,
): FireGrid {
  const rows = mask.length;
  const cols = mask[0].length;
  return stepFire(emptyGrid(rows, cols), mask, rng);
}

/** Hex color for a cell; black means "draw a space". */
export function fireHex(intensity: number): string {
  const [r, g, b] = fireColor(intensity);
  return `#${[r, g, b]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}
