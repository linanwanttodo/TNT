import { measureElement, useInput } from "ink";
import type { DOMElement } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { isJumpHintClick } from "../utils/mouse.js";

import { useMouseEvents } from "./useMouseEvents.js";

interface ChatViewportOptions {
  rows: number;
  chatHistory: ChatHistoryItem[];
}

/**
 * The transcript's scroll state. Ink can only clip the bottom of an
 * overflowing box, so scrolling hides the newest messages instead of moving a
 * measured pixel window; the viewport stays bottom-anchored, which also keeps
 * measurement out of the render path. The dock's height decides the hint's
 * row so a click on it can jump back to the live tail.
 */
export function useChatViewport({ rows, chatHistory }: ChatViewportOptions) {
  const [scrollBack, setScrollBack] = useState(0);
  const page = Math.max(1, Math.floor(rows / 3));
  const following = scrollBack === 0;
  const historyLength = chatHistory.length;

  const visibleHistory = useMemo(
    () =>
      scrollBack > 0
        ? chatHistory.slice(0, Math.max(0, historyLength - scrollBack))
        : chatHistory,
    [chatHistory, historyLength, scrollBack],
  );

  const dockRef = useRef<DOMElement | null>(null);
  const [dockHeight, setDockHeight] = useState(0);

  useEffect(() => {
    if (following || !dockRef.current) {
      setDockHeight(0);
      return;
    }
    try {
      setDockHeight(measureElement(dockRef.current).height);
    } catch {
      // Not laid out yet; the next render measures again.
    }
  });

  const scrollUp = () =>
    setScrollBack((count) =>
      Math.min(count + page, Math.max(0, historyLength - 1)),
    );
  const scrollDown = () => setScrollBack((count) => Math.max(0, count - page));

  useInput((_input, key) => {
    if (key.pageUp) scrollUp();
    if (key.pageDown) scrollDown();
    // End and Ctrl+End return to the live tail, like Pi's jump-to-latest.
    if (key.end) setScrollBack(0);
  });

  useMouseEvents(
    (event) => {
      if (event.name === "left-press") {
        if (isJumpHintClick(event, rows, dockHeight)) setScrollBack(0);
        return;
      }
      if (event.name === "scroll-up") scrollUp();
      if (event.name === "scroll-down") scrollDown();
    },
    { isActive: !following },
  );

  return { scrollBack, setScrollBack, following, dockRef, visibleHistory };
}
