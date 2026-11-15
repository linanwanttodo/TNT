import { useEffect, useState } from "react";

/** Claude Code's tool dot alternates once every 600 ms. */
export const BLINK_INTERVAL_MS = 600;

/**
 * The blink phase at a given elapsed time: visible for the first interval,
 * hidden for the second, and so on. Derived rather than toggled so every dot
 * that shares a clock agrees on the frame it is drawing.
 */
export function blinkVisibleAt(
  elapsedMs: number,
  intervalMs: number = BLINK_INTERVAL_MS,
): boolean {
  if (intervalMs <= 0) {
    return true;
  }
  return Math.floor(Math.max(0, elapsedMs) / intervalMs) % 2 === 0;
}

/**
 * Returns whether a blinking element is on its visible frame. Disabled
 * renderers are always visible, so a finished call never shows the hole.
 */
export function useBlink(
  enabled: boolean,
  intervalMs: number = BLINK_INTERVAL_MS,
): boolean {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(0);
    if (!enabled) {
      return;
    }

    const timer = setInterval(() => {
      setElapsedMs((elapsed) => elapsed + intervalMs);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs]);

  return blinkVisibleAt(elapsedMs, intervalMs);
}
