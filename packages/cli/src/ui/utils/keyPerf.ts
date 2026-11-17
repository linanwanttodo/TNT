import { performance } from "node:perf_hooks";

/**
 * Keystroke→frame latency ring, enabled with TNT_KEY_PERF=1.
 *
 * Fast-typing jank reports have never come with numbers: the paths involved
 * (stdin parse → reducer → render → ink frame) are each sub-10ms in isolated
 * probes, so the fix work needs the latency measured where it hurts — the
 * user's own terminal, session and input method. The composer marks every
 * keypress and settles it on the next commit; when the env flag is set the
 * status row prints the live last/avg/max so a slow environment identifies
 * itself instead of inviting another blind "fix".
 */

const RING_SIZE = 32;

const ring: number[] = [];
let last = 0;
/** The settled latency of the most recent completed sample. */
let lastDelta = 0;
let max = 0;
let enabled: boolean | null = null;

export function keyPerfEnabled(): boolean {
  if (enabled === null) {
    enabled = process.env.TNT_KEY_PERF === "1";
  }
  return enabled;
}

/** Marks the instant a raw key arrived; the next settle() closes one sample. */
export function keyPerfMark(): void {
  if (!keyPerfEnabled()) return;
  last = performance.now();
}

/** Closes the sample opened by the last mark(); safe to call without one. */
export function keyPerfSettle(): void {
  if (!keyPerfEnabled() || !last) return;
  const delta = performance.now() - last;
  last = 0;
  // `last` doubles as the mark timestamp, so it is reset to 0 here; the
  // summary must show the measured latency, not that raw timestamp.
  lastDelta = delta;
  ring.push(delta);
  if (ring.length > RING_SIZE) ring.shift();
  if (delta > max) max = delta;
}

/** One-line summary for the status row: last / avg / max in ms. */
export function keyPerfSummary(): string | null {
  if (!keyPerfEnabled() || ring.length === 0) return null;
  const avg = ring.reduce((sum, value) => sum + value, 0) / ring.length;
  return `⚡${lastDelta.toFixed(0)}ms 均${avg.toFixed(0)}ms 峰${max.toFixed(0)}ms`;
}
