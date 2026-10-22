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

export const FIRE_ROWS = 24;
export const FIRE_MAX_COLS = 40;
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
 * Blood-fire palette: black, then deep blood red through bright crimson,
 * with a rare pale ember at the very top. No yellows or golds - the banner
 * stays red and black.
 */
export function fireColor(intensity: number): [number, number, number] {
  if (intensity <= 0.05) return [0, 0, 0];
  if (intensity < 0.15) return [70, 5, 5];
  if (intensity < 0.35) return [120, 9, 9];
  if (intensity < 0.55) return [170, 14, 14];
  if (intensity < 0.75) return [210, 28, 28];
  if (intensity < 0.9) return [238, 62, 52];
  return [255, 150, 130];
}

function emptyGrid(rows: number, cols: number): FireGrid {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0),
  );
}

/**
 * One upward step of the fire. Sparse embers at the bottom grow into tall,
 * thin tongues: heat climbs with almost no sideways drift and dies with a
 * small probability per row, so flames stretch and gutter like dripping
 * blood instead of filling the field. The glyph cells stay dark - the
 * letters read as a black silhouette inside the red.
 */
export function stepFire(
  previous: FireGrid,
  mask: boolean[][],
  rng: Rng,
): FireGrid {
  const rows = previous.length;
  const cols = previous[0].length;
  const next = emptyGrid(rows, cols);

  // Sparse floor: roughly a third of the columns carry an ember this frame.
  for (let x = 0; x < cols; x += 1) {
    if (rng() < 0.66) continue;
    next[rows - 1][x] = 0.55 + rng() * 0.45;
  }

  for (let y = rows - 2; y >= 0; y -= 1) {
    for (let x = 0; x < cols; x += 1) {
      const source = previous[y + 1][x];
      if (source <= 0.05) continue;
      // A tongue most often continues straight up; it drifts sideways only
      // occasionally, which is what keeps it reading as a streak.
      const raw = rng();
      const drift = raw < 0.06 ? -1 : raw > 0.94 ? 1 : 0;
      const target = Math.min(cols - 1, Math.max(0, x + drift));
      // Slow decay plus a cull makes long, guttering tongues.
      const cull = rng() < 0.18 ? 1 : 0;
      const decayed = Math.max(0, source - (0.005 + rng() * 0.05) - cull);
      next[y][target] = Math.max(next[y][target], decayed);
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (mask[y][x]) next[y][x] = 0;
    }
  }

  return next;
}

/**
 * The first frame: the fire is stepped a few dozen times before it is shown,
 * so the tongues are already developed when the banner mounts instead of the
 * screen starting nearly empty.
 */
export function createFireGrid(
  mask: boolean[][],
  rng: Rng = Math.random,
): FireGrid {
  const rows = mask.length;
  const cols = mask[0].length;
  let grid = emptyGrid(rows, cols);
  for (let frame = 0; frame < 40; frame += 1) {
    grid = stepFire(grid, mask, rng);
  }
  return grid;
}

/** Hex color for a cell; black means "draw a space". */
export function fireHex(intensity: number): string {
  const [r, g, b] = fireColor(intensity);
  return `#${[r, g, b]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * The character ramp the flames are textured with, dark to white-hot. This is
 * the classic full-screen ASCII fire look: the flame front flickers between
 * these glyphs as the heat changes, instead of rendering solid pixels.
 */
export const FIRE_RAMP = " .:-=+*xX$&%@";

/** The ramp glyph for one cell; a space means "nothing burns here". */
export function fireGlyph(intensity: number): string {
  if (intensity <= 0.05) return " ";
  const index = Math.min(
    FIRE_RAMP.length - 1,
    Math.max(1, Math.round(intensity * (FIRE_RAMP.length - 1))),
  );
  return FIRE_RAMP[index];
}
