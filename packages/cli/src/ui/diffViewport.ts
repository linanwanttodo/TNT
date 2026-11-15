/**
 * Where the full-screen diff is looking, as arithmetic rather than state.
 *
 * The viewer scrolls a window over the diff's displayable rows and can jump
 * between hunks; both are index math with clamps, and a clamp that is off by one
 * either hides the last row for good or scrolls into blank space. Keeping it out
 * of the component is what makes that testable without a terminal.
 */
export interface DiffWindow {
  /** First visible row, always inside `0 .. max(0, total - height)`. */
  offset: number;
  /** One past the last visible row, at most `total`. */
  end: number;
}

export function diffWindow(
  total: number,
  offset: number,
  height: number,
): DiffWindow {
  const safeHeight = Math.max(1, Math.floor(height));
  const lastStart = Math.max(0, total - safeHeight);
  const start = Math.min(Math.max(0, Math.floor(offset)), lastStart);
  return { offset: start, end: Math.min(total, start + safeHeight) };
}

/** Row index of every hunk header, in order. */
export function hunkRows(lines: { type: string }[]): number[] {
  const rows: number[] = [];
  lines.forEach((line, index) => {
    if (line.type === "hunk") {
      rows.push(index);
    }
  });
  return rows;
}

/**
 * The same rows, counted in the coordinates the viewer scrolls in: hunks and
 * metadata rows are not rendered, so a hunk's position is how many displayable
 * rows precede it. Comparing a raw index with a scroll offset was the bug this
 * exists to prevent.
 */
export function hunkDisplayRows(lines: { type: string }[]): number[] {
  const rows: number[] = [];
  let displayable = 0;
  for (const line of lines) {
    if (line.type === "hunk") {
      rows.push(displayable);
    } else if (line.type !== "other") {
      displayable += 1;
    }
  }
  return rows;
}

/**
 * The next hunk row strictly past `offset` in `direction`, or `undefined` at the
 * ends - which is how the viewer knows not to redraw.
 */
export function nextHunk(
  rows: number[],
  offset: number,
  direction: 1 | -1,
): number | undefined {
  if (direction === 1) {
    return rows.find((row) => row > offset);
  }
  let candidate: number | undefined;
  for (const row of rows) {
    if (row < offset) {
      candidate = row;
    }
  }
  return candidate;
}
