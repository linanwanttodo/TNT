import { useStdout } from "ink";
import { useEffect, useState } from "react";

const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 80;

type ResizeStream = ReturnType<typeof useStdout>["stdout"];

interface SharedResize {
  listeners: Set<() => void>;
  handler: () => void;
}

// One resize listener per stream, fanned out to every consumer. One listener
// each crossed Node's 10-listener default, and the MaxListeners warning is
// printed to stdout while Ink owns the screen, which overwrites the composer.
const sharedResize = new WeakMap<object, SharedResize>();

function subscribeResize(
  stream: ResizeStream,
  listener: () => void,
): () => void {
  let entry = sharedResize.get(stream);
  if (!entry) {
    const listeners = new Set<() => void>();
    const handler = (): void => {
      for (const notify of listeners) {
        notify();
      }
    };
    stream.on("resize", handler);
    entry = { listeners, handler };
    sharedResize.set(stream, entry);
  }
  entry.listeners.add(listener);
  return () => {
    const current = sharedResize.get(stream);
    if (!current) {
      return;
    }
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      stream.removeListener("resize", current.handler);
      sharedResize.delete(stream);
    }
  };
}

const useTerminalSize = (debounce = 100) => {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    columns: stdout.columns || DEFAULT_COLS,
    rows: stdout.rows || DEFAULT_ROWS,
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;

    const handleResize = () => {
      setIsResizing(true);

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        setDimensions({
          columns: stdout.columns || DEFAULT_COLS,
          rows: stdout.rows || DEFAULT_ROWS,
        });
        setIsResizing(false);
      }, debounce);
    };

    const unsubscribe = subscribeResize(stdout, handleResize);
    return () => {
      unsubscribe();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [stdout, debounce]);

  return { ...dimensions, isResizing };
};

export { useTerminalSize };
