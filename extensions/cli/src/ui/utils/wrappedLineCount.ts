/**
 * Rough estimate of how many terminal rows a block of text will occupy once
 * hard-wrapped to `columns` wide. Markdown rendering is not line-exact, so this
 * is intentionally approximate: it under-estimates by ignoring rendered block
 * margins, but it is enough to decide when the transcript is taller than the
 * viewport and therefore scrollable.
 */
export function estimateWrappedLineCount(
  text: string,
  columns: number,
): number {
  const width = Math.max(1, columns);
  let lines = 0;

  for (const rawLine of text.split("\n")) {
    if (rawLine.length === 0) {
      lines += 1;
      continue;
    }
    // ceil division: a line of length L needs ceil(L / width) rows.
    lines += Math.ceil(rawLine.length / width);
  }

  return Math.max(1, lines);
}

/**
 * Estimate the total height (in rows) of a chunked chat history. Each history
 * item already represents roughly one screen-ish block, so we count the number
 * of items plus a small buffer per item for spacing and headers.
 */
export function estimateHistoryHeight(
  itemCount: number,
  columns: number,
): number {
  // Per-item overhead covers the "> " prompt line, blank separators and any
  // short headers. It is a conservative constant, not line-exact.
  const perItemOverhead = 3;
  return Math.max(1, itemCount * perItemOverhead);
}
