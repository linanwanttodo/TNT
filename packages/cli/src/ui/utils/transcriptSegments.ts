/**
 * Splits the rendered transcript into the part that can be printed once and
 * the part that is still changing.
 *
 * Ink writes an item handed to <Static> above the live frame exactly once, so
 * anything placed there has to be final. Only the trailing items belong to the
 * live frame: the answer still being streamed, the tool call still running.
 * Everything before them has stopped changing and goes to the terminal
 * scrollback.
 */
export interface TranscriptSegments<T> {
  settled: readonly T[];
  live: readonly T[];
}

export function splitTranscriptSegments<T>(
  items: readonly T[],
  liveItemCount: number,
): TranscriptSegments<T> {
  const liveCount = Math.min(Math.max(liveItemCount, 0), items.length);
  const settledCount = items.length - liveCount;

  return {
    settled: items.slice(0, settledCount),
    live: items.slice(settledCount),
  };
}
