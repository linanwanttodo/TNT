import { useStdin } from "ink";
import { useEffect, useRef } from "react";

import {
  MOUSE_DISABLE,
  MOUSE_ENABLE,
  drainMouseEvents,
  type MouseEvent,
} from "../utils/mouse.js";

/**
 * Enables terminal mouse reporting only while `isActive`, and disables it on
 * the way out so the reader's normal drag-to-select comes back. Sequences are
 * buffered because a single read can end mid-sequence.
 *
 * Staying ON is deliberate: a 1.2.9 attempt to drop the mode entirely
 * coincided with input regressions (Chinese commits not landing, lagging
 * letters) across terminal emulators. The mode is not an input-method switch,
 * so it stays as shipped and is not changed without cross-terminal evidence.
 * Pre-edit visibility comes from the terminal cursor placement in the forked
 * ink renderer, not from any terminal mode.
 */
export function useMouseEvents(
  onEvent: (event: MouseEvent) => void,
  { isActive }: { isActive: boolean },
): void {
  const { stdin } = useStdin();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!isActive) return;

    process.stdout.write(MOUSE_ENABLE);
    let buffer = "";

    const onData = (data: Buffer | string) => {
      buffer += typeof data === "string" ? data : data.toString("utf-8");
      const { events, rest } = drainMouseEvents(buffer);
      buffer = rest;
      for (const event of events) handlerRef.current(event);
    };

    stdin.on("data", onData);
    return () => {
      stdin.removeListener("data", onData);
      process.stdout.write(MOUSE_DISABLE);
    };
  }, [isActive, stdin]);
}
