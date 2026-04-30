import { useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ScrollViewMetrics } from "../components/ScrollView.js";
import { dispatchClick } from "../utils/clickRegions.js";
import { isTerminalMouseSequence } from "../utils/mouse.js";
import { WheelFrameBatch } from "../utils/wheelFrameBatch.js";
import { WheelScrollAccelerator } from "../utils/wheelScroll.js";

import { useLayoutRevision } from "./layoutDirty.js";
import { useMouseEvents } from "./useMouseEvents.js";

interface ChatViewportOptions {
  /** Only the chat screen owns the mouse wheel and the scroll keys. */
  isActive: boolean;
}

interface ViewportState {
  contentHeight: number;
  viewportHeight: number;
  /** Rows hidden above the window; ignored while following the tail. */
  scrollTop: number;
  following: boolean;
}

export interface ChatViewport {
  /** Rows hidden above the window, already clamped to the content. */
  scrollTop: number;
  /** True while the window is at the live tail. */
  following: boolean;
  maxScrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  /** Whether the terminal is reporting mouse events to the app. */
  mouseCapture: boolean;
  onMetrics: (metrics: ScrollViewMetrics) => void;
  scrollBy: (rows: number) => void;
  scrollTo: (row: number) => void;
  jumpToBottom: () => void;
}

const INITIAL_STATE: ViewportState = {
  contentHeight: 0,
  viewportHeight: 0,
  scrollTop: 0,
  following: true,
};

function maxScrollTopOf(state: ViewportState): number {
  return Math.max(0, state.contentHeight - state.viewportHeight);
}

/**
 * The transcript's scroll state.
 *
 * The offset is measured in terminal rows from the top of the transcript, not
 * in messages. Layout reports the real content height, the viewport clamps
 * the offset to it, and a view that is at the end keeps following new rows.
 * Whole-message stepping cannot be correct because a single answer can be
 * taller than the screen.
 */
export function useChatViewport({
  isActive,
}: ChatViewportOptions): ChatViewport {
  const [state, setState] = useState<ViewportState>(INITIAL_STATE);
  // Mouse reporting is on by default so the wheel scrolls the transcript;
  // Ctrl+T releases the terminal's mouse so a drag selects and copies text
  // the normal way, and again to take it back. TNT_DISABLE_MOUSE=1 starts
  // released, for terminals whose copy-on-select the user never wants broken.
  const [mouseCapture, setMouseCapture] = useState(
    process.env.TNT_DISABLE_MOUSE !== "1",
  );
  // A nested panel can change height without rendering this hook; the returned
  // revision is unused on purpose - its re-render is what lets ScrollView
  // measure the layout that was just committed.
  useLayoutRevision();
  const wheelRef = useRef<WheelScrollAccelerator | null>(null);
  wheelRef.current ??= new WheelScrollAccelerator("auto");

  const onMetrics = useCallback((metrics: ScrollViewMetrics) => {
    setState((previous) => {
      if (
        previous.contentHeight === metrics.contentHeight &&
        previous.viewportHeight === metrics.viewportHeight
      ) {
        return previous;
      }

      return {
        ...previous,
        contentHeight: metrics.contentHeight,
        viewportHeight: metrics.viewportHeight,
      };
    });
  }, []);

  const scrollTo = useCallback((row: number) => {
    if (!Number.isFinite(row)) return;

    setState((previous) => {
      const maxScrollTop = maxScrollTopOf(previous);
      const next = Math.round(Math.max(0, Math.min(maxScrollTop, row)));
      const following = next >= maxScrollTop;

      if (previous.scrollTop === next && previous.following === following) {
        return previous;
      }

      return { ...previous, scrollTop: next, following };
    });
  }, []);

  const scrollBy = useCallback((rows: number) => {
    if (!Number.isFinite(rows) || rows === 0) return;

    setState((previous) => {
      const maxScrollTop = maxScrollTopOf(previous);
      // A following view starts from the tail, so the end of the content is
      // the origin of the first wheel notch.
      const start = previous.following
        ? maxScrollTop
        : Math.min(previous.scrollTop, maxScrollTop);
      const next = Math.round(
        Math.max(0, Math.min(maxScrollTop, start + rows)),
      );
      const following = next >= maxScrollTop;

      if (previous.scrollTop === next && previous.following === following) {
        return previous;
      }

      return { ...previous, scrollTop: next, following };
    });
  }, []);

  const jumpToBottom = useCallback(() => {
    setState((previous) => {
      const maxScrollTop = maxScrollTopOf(previous);
      if (previous.following && previous.scrollTop === maxScrollTop) {
        return previous;
      }

      return { ...previous, scrollTop: maxScrollTop, following: true };
    });
  }, []);

  const page = Math.max(1, state.viewportHeight - 1);

  // Wheel events arrive in bursts faster than a frame; the batch applies one
  // net delta per frame instead of one render per notch.
  const wheelBatchRef = useRef<WheelFrameBatch | null>(null);
  wheelBatchRef.current ??= new WheelFrameBatch(scrollBy);
  useEffect(() => () => wheelBatchRef.current?.dispose(), []);

  useInput(
    (input, key) => {
      // A mouse report also reaches useInput; it must not be read as End or
      // Home and drag the viewport to the top on a click.
      if (isTerminalMouseSequence(input)) return;

      if (key.ctrl && input === "t") {
        setMouseCapture((previous) => !previous);
      } else if (key.pageUp) {
        scrollBy(-page);
      } else if (key.pageDown) {
        scrollBy(page);
      } else if (key.end) {
        jumpToBottom();
      } else if (key.home) {
        scrollTo(0);
      }
    },
    { isActive },
  );

  useMouseEvents(
    (event) => {
      if (event.name === "scroll-up") {
        wheelBatchRef.current!.add(-wheelRef.current!.next(-1, Date.now()));
      } else if (event.name === "scroll-down") {
        wheelBatchRef.current!.add(wheelRef.current!.next(1, Date.now()));
      } else if (event.name === "left-press") {
        dispatchClick(event.row, event.col);
      }
    },
    { isActive: isActive && mouseCapture },
  );

  return {
    scrollTop: state.following
      ? maxScrollTopOf(state)
      : Math.min(state.scrollTop, maxScrollTopOf(state)),
    following: state.following,
    maxScrollTop: maxScrollTopOf(state),
    viewportHeight: state.viewportHeight,
    contentHeight: state.contentHeight,
    mouseCapture,
    onMetrics,
    scrollBy,
    scrollTo,
    jumpToBottom,
  };
}
