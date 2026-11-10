// Thresholds and limits shared by the composer's input buffer, split out of
// TextBuffer.ts to keep the buffer itself under the max-lines budget.

export const COLLAPSE_SIZE = 500; // Characters threshold for collapsing pasted content
export const COLLAPSE_LINES = 8; // Lines threshold: a paste reaching this many rows collapses too
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB per image
export const MAX_IMAGE_COUNT = 20; // Maximum number of images
export const MAX_TOTAL_IMAGE_MEMORY = 50 * 1024 * 1024; // 50MB total image memory

/**
 * Whether one pasted block is large enough to fold behind a placeholder:
 * the first of the two thresholds it reaches wins, so an eight-row paste
 * collapses no matter how short its lines and a 500-character one-line
 * paste collapses without any rows to count.
 */
export function shouldCollapsePaste(text: string): boolean {
  if (text.length >= COLLAPSE_SIZE) return true;
  return pasteLineCount(text) >= COLLAPSE_LINES;
}

export function pasteLineCount(text: string): number {
  return text.split(/\r\n|\r|\n/).length;
}
