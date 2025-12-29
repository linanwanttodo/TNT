/** Lines the transcript can move up before it reaches the oldest content. */
export function maxViewportScroll(available: number, content: number): number {
  return Math.max(0, content - available);
}

/**
 * Blank rows below the transcript inside a fixed viewport. When the transcript
 * is short the spacer fills the leftover rows so the transcript starts at the
 * top; when it overflows, the spacer is the scroll distance, so increasing it
 * moves older lines into view without re-rendering the transcript.
 */
export function viewportSpacer(
  available: number,
  content: number,
  scrollOffset: number,
): number {
  const offset = Math.min(
    Math.max(0, scrollOffset),
    maxViewportScroll(available, content),
  );
  return Math.max(0, available - content) + offset;
}
