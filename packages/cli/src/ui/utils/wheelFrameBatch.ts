/**
 * Merges a burst of wheel events into one scroll per frame.
 *
 * A fast wheel spin delivers several events inside the window a terminal can
 * paint once. Applying each event separately re-renders the transcript for
 * rows the reader never saw; batching within a frame window applies the net
 * delta a single time instead.
 *
 * Batching sums the deltas, which can differ from replaying them one by one
 * when a scroll hits the top or bottom clamp mid-burst. The difference is
 * bounded by the burst width and invisible at frame cadence, the same
 * trade-off terminal scroll coalescers have always made.
 */
export class WheelFrameBatch {
  private pendingRows = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** Applies the net delta of one frame's worth of events. */
    private readonly apply: (rows: number) => void,
    private readonly frameMs = 16,
  ) {}

  /** Adds one wheel event's rows and schedules the frame flush. */
  add(rows: number): void {
    if (!Number.isFinite(rows) || rows === 0) return;

    this.pendingRows += rows;
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.frameMs);
    }
  }

  /** Applies the pending delta now; a no-op when the frame is empty. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const rows = this.pendingRows;
    this.pendingRows = 0;
    if (rows !== 0) {
      this.apply(rows);
    }
  }

  /** Drops the pending delta without applying it. */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingRows = 0;
  }
}
