import { useEffect, useRef, useState } from "react";

/**
 * Reveals the streaming answer a few characters at a time.
 *
 * Ink redraws the whole frame, so this is a cost, not a free effect: it is off
 * unless `TNT_STREAM_REVEAL=1`, and it only ever slices the live tail the
 * transcript already keeps separate from the settled prefix. The step grows with
 * how far the model is ahead, because a fixed one character per tick falls
 * seconds behind a fast stream and turns into its own kind of lag.
 */
export const REVEAL_TICK_MS = 33;

/** Past this many characters the slice is not worth a redraw per tick. */
export const REVEAL_MAX_CHARS = 8_000;

export function revealEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TNT_STREAM_REVEAL === "1";
}

export function nextRevealLength(
  shown: number,
  available: number,
  elapsedMs: number,
): number {
  if (available <= shown) {
    return available;
  }
  const pending = available - shown;
  const perTick = Math.max(1, Math.ceil(pending / 8));
  const ticks = Math.max(1, Math.ceil(elapsedMs / REVEAL_TICK_MS));
  return Math.min(available, shown + perTick * ticks);
}

/** The part of `text` to draw this frame. `null` when there is nothing to draw. */
export function useRevealedText(text: string | null): string | null {
  const enabled = revealEnabled();
  const [shown, setShown] = useState(0);
  const lastTick = useRef(Date.now());

  useEffect(() => {
    if (text === null) {
      setShown(0);
      return;
    }
    if (!enabled || text.length > REVEAL_MAX_CHARS || text.length <= shown) {
      setShown(text.length);
      return;
    }
    const timer = setTimeout(() => {
      const now = Date.now();
      const elapsed = now - lastTick.current;
      lastTick.current = now;
      setShown((current) => nextRevealLength(current, text.length, elapsed));
    }, REVEAL_TICK_MS);
    return () => clearTimeout(timer);
  }, [text, shown, enabled]);

  if (text === null) {
    return null;
  }
  if (!enabled || text.length > REVEAL_MAX_CHARS) {
    return text;
  }
  return text.slice(0, Math.min(shown, text.length));
}
