/**
 * Converts mouse-wheel events into a row count.
 *
 * A terminal either accelerates the wheel itself - local macOS terminals send
 * one event per row - or sends one event per notch. Treating a notch as one
 * row makes fast spins feel unresponsive, so velocity is used when the
 * terminal does not do the acceleration. This is the same model pi's TUI
 * uses for its alternate-screen viewport.
 */
export type WheelScrollLines = number | "auto";

// Events closer than this belong to one physical notch or come from a
// high-resolution source; they move one row each and do not accelerate.
const BURST_GAP_MS = 5;
// A pause longer than this ends a scroll gesture.
const GESTURE_GAP_MS = 200;
// Average event gap that maps to one row per event.
const REFERENCE_GAP_MS = 100;
const MAX_AUTO_LINES = 6;

function terminalAcceleratesWheel(): boolean {
  const env = process.env;

  return (
    process.platform === "darwin" &&
    env.SSH_CONNECTION === undefined &&
    env.SSH_CLIENT === undefined &&
    env.SSH_TTY === undefined
  );
}

export class WheelScrollAccelerator {
  private lines: WheelScrollLines;
  private readonly accelerate: boolean;
  private lastTime = Number.NEGATIVE_INFINITY;
  private lastDirection = 0;
  private averageGap: number | undefined;
  private carry = 0;

  constructor(
    lines: WheelScrollLines = "auto",
    accelerate = !terminalAcceleratesWheel(),
  ) {
    this.lines = lines;
    this.accelerate = accelerate;
  }

  setLines(lines: WheelScrollLines): void {
    this.lines = lines;
    this.reset();
  }

  /**
   * Rows for one wheel event in `direction` (-1 up, 1 down) at `now` in
   * milliseconds. Always at least one row.
   */
  next(direction: -1 | 1, now: number): number {
    if (this.lines !== "auto") {
      return Number.isFinite(this.lines)
        ? Math.max(1, Math.floor(this.lines))
        : 1;
    }

    if (!this.accelerate) return 1;

    const gap = now - this.lastTime;
    const sameGesture =
      direction === this.lastDirection && gap <= GESTURE_GAP_MS;
    this.lastTime = now;
    this.lastDirection = direction;

    if (!sameGesture) {
      this.averageGap = undefined;
      this.carry = 0;
      return 1;
    }

    if (gap < BURST_GAP_MS) return 1;

    this.averageGap =
      this.averageGap === undefined ? gap : (this.averageGap + gap) / 2;
    const rows =
      Math.min(
        MAX_AUTO_LINES,
        Math.max(1, REFERENCE_GAP_MS / this.averageGap),
      ) + this.carry;
    const whole = Math.floor(rows);
    this.carry = rows - whole;

    return whole;
  }

  private reset(): void {
    this.lastTime = Number.NEGATIVE_INFINITY;
    this.lastDirection = 0;
    this.averageGap = undefined;
    this.carry = 0;
  }
}
