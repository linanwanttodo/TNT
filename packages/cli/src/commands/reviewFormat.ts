/**
 * The formats `renderReport` can produce. Anything else is refused rather than silently
 * rendered as text, and `text` is a real value - it is the default, not an absence.
 */
export function unsupportedReviewFormat(
  value: string | undefined,
): string | null {
  if (value === undefined || value === "text" || value === "json") return null;
  return value;
}
