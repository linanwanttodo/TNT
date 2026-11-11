import { useStdin } from "ink";
import { useEffect, useRef } from "react";

import { drainMouseEvents, type MouseEvent } from "../utils/mouse.js";

/**
 * Receives terminal mouse reports while `isActive`. The reporting mode itself
 * is deliberately NOT enabled: forcing DECSET 1000/1006 on suppresses the
 * inline IME pre-edit in JetBrains terminals, so the reader loses their
 * composition string while typing Chinese. Sequences are still drained
 * defensively in case a surface reports them anyway.
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
    };
  }, [isActive, stdin]);
}
