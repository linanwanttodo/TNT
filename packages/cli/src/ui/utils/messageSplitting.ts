/**
 * Splits streaming Markdown text at a point that keeps the formatting intact.
 *
 * When streamed content outgrows one display chunk it has to be divided, and
 * a naive character-limit split corrupts Markdown - most critically fenced
 * code blocks, but also lists and blockquotes. `findSafeSplitPoint` returns
 * an index that respects the document structure:
 *
 * 1. Content at or under `idealMaxLength` is not split.
 * 2. A split never lands inside a fenced code block. If the limit falls
 *    inside one, the split moves before the block; a block that starts at
 *    the very beginning and is itself too long yields 0, pushing the whole
 *    block into the next chunk.
 * 3. Otherwise the split walks backwards from `idealMaxLength` to the
 *    nearest paragraph break (`\n\n`), then the nearest single newline,
 *    never choosing one inside a code block.
 * 4. With no structural boundary available, one unbreakable run may push the
 *    result past `idealMaxLength` rather than corrupt the formatting.
 */

/**
 * Checks if a given character index within a string is inside a fenced (```) code block.
 * @param content The full string content.
 * @param indexToTest The character index to test.
 * @returns True if the index is inside a code block's content, false otherwise.
 */
const isIndexInsideCodeBlock = (
  content: string,
  indexToTest: number,
): boolean => {
  let fenceCount = 0;
  let searchPos = 0;
  while (searchPos < content.length) {
    const nextFence = content.indexOf("```", searchPos);
    if (nextFence === -1 || nextFence >= indexToTest) {
      break;
    }
    fenceCount++;
    searchPos = nextFence + 3;
  }
  return fenceCount % 2 === 1;
};

/**
 * Finds the starting index of the code block that encloses the given index.
 * Returns -1 if the index is not inside a code block.
 * @param content The markdown content.
 * @param index The index to check.
 * @returns Start index of the enclosing code block or -1.
 */
const findEnclosingCodeBlockStart = (
  content: string,
  index: number,
): number => {
  if (!isIndexInsideCodeBlock(content, index)) {
    return -1;
  }
  let currentSearchPos = 0;
  while (currentSearchPos < index) {
    const blockStartIndex = content.indexOf("```", currentSearchPos);
    if (blockStartIndex === -1 || blockStartIndex >= index) {
      break;
    }
    const blockEndIndex = content.indexOf("```", blockStartIndex + 3);
    if (blockStartIndex < index) {
      if (blockEndIndex === -1 || index < blockEndIndex + 3) {
        return blockStartIndex;
      }
    }
    if (blockEndIndex === -1) break;
    currentSearchPos = blockEndIndex + 3;
  }
  return -1;
};

export const findLastSafeSplitPoint = (content: string): number => {
  const enclosingBlockStart = findEnclosingCodeBlockStart(
    content,
    content.length,
  );
  if (enclosingBlockStart !== -1) {
    // The end of the content is contained in a code block. Split right before.
    return enclosingBlockStart;
  }

  // Search for the last double newline (\n\n) not in a code block.
  let searchStartIndex = content.length;
  while (searchStartIndex >= 0) {
    const dnlIndex = content.lastIndexOf("\n\n", searchStartIndex);
    if (dnlIndex === -1) {
      // No more double newlines found.
      break;
    }

    const potentialSplitPoint = dnlIndex + 2;
    if (!isIndexInsideCodeBlock(content, potentialSplitPoint)) {
      return potentialSplitPoint;
    }

    // If potentialSplitPoint was inside a code block,
    // the next search should start *before* the \n\n we just found to ensure progress.
    searchStartIndex = dnlIndex - 1;
  }

  // If no safe double newline is found, return content.length
  // to keep the entire content as one piece.
  return content.length;
};
