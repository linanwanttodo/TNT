import { Box, type DOMElement, measureElement } from "ink";
import React, { useLayoutEffect, useRef } from "react";

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
 */
export const ScrollView: React.FC<ScrollViewProps> = ({
  scrollTop,
  onMetrics,
  children,
}) => {
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    onMetrics({
      contentHeight: measureElement(content).height,
      viewportHeight: measureElement(viewport).height,
    });
  });

  return (
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
  );
};
