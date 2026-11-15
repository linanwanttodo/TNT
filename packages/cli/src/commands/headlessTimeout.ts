import { REQUEST_TIMEOUT_ABORT } from "../loop/termination.js";

/**
 * A headless run with no deadline waits on the provider forever: CI jobs hang
 * instead of failing, and nothing tells the caller why. The deadline is a
 * setting rather than a constant because a long tool-heavy run is not the same
 * job as a one-line summary.
 */
export const HEADLESS_DEFAULT_TIMEOUT_SECONDS = 300;

/**
 * `0` means no deadline. Anything that is not a whole number of seconds falls
 * back to the default, so a typo leaves the run bounded instead of unbounded.
 */
export function resolveTimeoutSeconds(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return HEADLESS_DEFAULT_TIMEOUT_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : HEADLESS_DEFAULT_TIMEOUT_SECONDS;
}

/**
 * Aborts `controller` once `seconds` have passed and reports through `onFire`
 * before the abort, so the caller can label the partial answer it still holds.
 * Returns the cancel step; a non-positive `seconds` arms nothing at all.
 */
export function armTimeout(
  controller: AbortController,
  seconds: number,
  onFire: () => void,
): () => void {
  if (seconds <= 0) {
    return () => {};
  }

  const timer = setTimeout(() => {
    onFire();
    controller.abort(REQUEST_TIMEOUT_ABORT);
  }, seconds * 1000);
  timer.unref?.();

  return () => clearTimeout(timer);
}
