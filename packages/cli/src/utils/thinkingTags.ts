/**
 * The legacy think-tag format, in one place.
 *
 * Providers that predate a typed reasoning channel embed the thought in the
 * answer text. The transcript projection, the message renderer and the headless
 * output all have to split it out, and they used to do it with three different
 * patterns - one of which gated on a case-sensitive `includes` while the regex
 * beside it ignored case.
 */

/** The thought is the first capture group; an unclosed tag runs to the end. */
export function thinkBlockPattern(): RegExp {
  return /<think>([\s\S]*?)(?:<\/think>|$)/gi;
}

/** Only a closed block is a finished thought. Used where the text is final. */
export function closedThinkBlockPattern(): RegExp {
  return /<think>([\s\S]*?)<\/think>/gi;
}

/**
 * Splits the first think block out of assistant text.
 *
 * The first block is the thought. Every block is removed from the body, so the
 * answer never keeps a tag the reader would otherwise see. Text after an
 * unclosed tag belongs to the thought, because that is where the model is when
 * the stream stops.
 */
export function extractThinkingContent(rawText: string): {
  thinking?: string;
  cleanedText: string;
} {
  if (!rawText) {
    return { cleanedText: "" };
  }

  const blocks = [...rawText.matchAll(thinkBlockPattern())];
  if (blocks.length === 0) {
    return { cleanedText: rawText };
  }

  const thinking = blocks[0][1]?.trim() ?? "";
  const cleanedText = blocks
    .reduce((text, block) => text.replace(block[0], ""), rawText)
    .trim();

  return { thinking, cleanedText };
}

/**
 * Removes finished think blocks and the blank runs they leave behind, for
 * output that has already completed (the headless `--silent` answer).
 */
export function stripThinkTags(rawText: string): string {
  return rawText
    .replace(closedThinkBlockPattern(), "")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}
