import { Box, type DOMElement, measureElement } from "ink";
import React, { useLayoutEffect, useRef, useState } from "react";

import { scrollbarGeometry } from "../utils/scrollbar.js";

import { ScrollBarColumn } from "./ScrollBarColumn.js";

export interface ScrollViewMetrics {
  /** Height of the whole transcript, in terminal rows. */
  contentHeight: number;
  /** Height of the clipping window, in terminal rows. */
  viewportHeight: number;
}

interface ScrollViewProps {
  /** Rows hidden above the window. Always clamped by the caller. */
  scrollTop: number;
  onMetrics: (metrics: ScrollViewMetrics) => void;
  /** Draws a one-column scrollbar on the right edge of the window. */
  showScrollbar?: boolean;
  children: React.ReactNode;
}

/**
 * A clipped, row-addressed window over its children.
 *
 * Ink has no scroll container, so the window is a fixed-height box with
 * `overflowY="hidden"` and the children are translated up by a negative top
 * margin. The content is laid out in full, which lets `measureElement` report
 * the real height: the previous implementation estimated a message's height
 * and sliced history by whole messages, so any message taller than its guess
 * left the window short and the transcript looked empty after a scroll.
 *
 * Measurement runs in a layout effect, before Ink writes the frame, so the
 * first paint after a resume already shows the measured tail rather than one
 * frame of the top of the conversation.
 *
 * With `showScrollbar` the window is joined by a one-column track whose
 * position and thumb are derived from the measured geometry, the way every
 * terminal scrollbar reads: the thumb spans the viewport/content ratio and
 * slides with the scroll fraction. The column is always reserved, so the bar
 * never re-wraps the content by appearing.
 */
export const ScrollView: React.FC<ScrollViewProps> = ({
  scrollTop,
  onMetrics,
  showScrollbar = false,
  children,
}) => {
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const [metrics, setMetrics] = useState<ScrollViewMetrics>({
    contentHeight: 0,
    viewportHeight: 0,
  });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const next = {
      contentHeight: measureElement(content).height,
      viewportHeight: measureElement(viewport).height,
    };
    setMetrics((previous) =>
      previous.contentHeight === next.contentHeight &&
      previous.viewportHeight === next.viewportHeight
        ? previous
        : next,
    );
    onMetrics(next);
  });

  const geometry = showScrollbar
    ? scrollbarGeometry(
        scrollTop,
        metrics.viewportHeight,
        metrics.contentHeight,
      )
    : null;

  return (
    <Box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0}>
      <Box
        ref={viewportRef}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflowY="hidden"
      >
        <Box
          ref={contentRef}
          flexDirection="column"
          flexShrink={0}
          marginTop={-Math.max(0, Math.floor(scrollTop))}
        >
          {children}
        </Box>
      </Box>
      {showScrollbar && <ScrollBarColumn geometry={geometry} />}
    </Box>
  );
};
