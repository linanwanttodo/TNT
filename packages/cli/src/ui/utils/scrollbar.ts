export interface ScrollbarGeometry {
  /** False when the content fits the viewport and no bar should be drawn. */
  scrollable: boolean;
  /** Rows the track occupies; the viewport height. */
  trackHeight: number;
  /** First row of the thumb within the track. */
  thumbTop: number;
  /** Rows the thumb spans, at least one when scrollable. */
  thumbHeight: number;
}

/**
 * The scrollbar's place on its one-column track, from the measured state.
 * The thumb's length is the viewport/content ratio and its position the
 * scroll fraction, always clamped inside the track and never smaller than
 * one row.
 */
export function scrollbarGeometry(
  scrollTop: number,
  viewportHeight: number,
  contentHeight: number,
): ScrollbarGeometry {
  if (viewportHeight <= 0 || contentHeight <= viewportHeight) {
    return {
      scrollable: false,
      trackHeight: Math.max(0, Math.floor(viewportHeight)),
      thumbTop: 0,
      thumbHeight: 0,
    };
  }

  const trackHeight = Math.floor(viewportHeight);
  const thumbHeight = Math.max(
    1,
    Math.round((viewportHeight * viewportHeight) / contentHeight),
  );
  const maxScroll = contentHeight - viewportHeight;
  const unclamped = Math.round(
    ((trackHeight - thumbHeight) * Math.max(0, scrollTop)) / maxScroll,
  );
  const thumbTop = Math.max(0, Math.min(trackHeight - thumbHeight, unclamped));

  return { scrollable: true, trackHeight, thumbTop, thumbHeight };
}
