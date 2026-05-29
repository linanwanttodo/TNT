/** Working indicator ported from ZCode's ChatLoadingPixels + shimmer label. */
import { useEffect, useState } from "react";

import css from "./ChatLoading.module.css";

/** The orbit the 3x3 grid lights up in; the center cell stays dim. */
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];

export function ChatLoadingPixels() {
  return (
    <span aria-hidden="true" className={css.pixelGrid}>
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className={css.pixel}
          style={{
            opacity: index === 4 ? 0.07 : 0.15,
            animationName: index === 4 ? "none" : undefined,
            animationDuration: "950ms",
            animationDelay: `${Math.max(0, ORBIT_ORDER.indexOf(index)) * 110}ms`,
          }}
        />
      ))}
    </span>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
    : `${seconds}s`;
}

/**
 * The "working" row: orbiting pixel grid, shimmer label, and an elapsed-time
 * counter that refreshes on its own timer so the transcript does not
 * re-render every 100ms with it.
 */
export function ChatLoading({ startedAt }: { startedAt?: number }) {
  const [start] = useState(() => startedAt ?? Date.now());
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - start);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => window.clearInterval(timer);
  }, [start]);
  return (
    <div
      role="status"
      className={css.row}
      data-zcode-chat-loading-animate="true"
    >
      <ChatLoadingPixels />
      <span className="zcode-loading-label">Working</span>
      <span className={css.elapsed}>{formatElapsed(elapsedMs)}</span>
    </div>
  );
}
