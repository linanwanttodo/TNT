import * as fs from "fs";

import type { ChatHistoryItem } from "core/index.js";

import { getSessionFilePath } from "../session/index.js";
import { parseEnvNumber } from "../utils/truncateOutput.js";

/**
 * A warm prefix is the whole reason old tool results are worth carrying: while the
 * provider still holds the bytes it already read them into, re-sending them costs
 * nothing. Once that cache has expired - Anthropic's default lifetime is five
 * minutes - they are paid for again at the full input rate, on every later request,
 * for a search that finished half an hour ago. So the first request after such a
 * gap drops their content and keeps the shape of the conversation: the message and
 * the tool call stay, because the API requires the pairing, and only the bulk goes.
 *
 * The last turn is never touched. It is what the running request is about.
 */
export const DEFAULT_CACHE_GAP_MS = 5 * 60 * 1000;
export const CLEARED_TOOL_RESULT_CONTENT = "[Old tool result content cleared]";

export function cacheGapMs(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_CACHE_GAP_MS,
    DEFAULT_CACHE_GAP_MS,
  );
}

let lastRequestAt: number | undefined;

/** Called when a request actually goes out; the gap is measured from then. */
export function noteRequestSent(now: number = Date.now()): void {
  lastRequestAt = now;
}

export function forgetLastRequest(): void {
  lastRequestAt = undefined;
}

/**
 * When this process has sent nothing yet - a resumed session - the session file's
 * own timestamp is the honest answer to "how long has this conversation been idle",
 * and it is the case that matters most: a session picked up tomorrow is certain to
 * have lost its cache.
 */
export function lastActivityAt(): number | undefined {
  if (lastRequestAt !== undefined) {
    return lastRequestAt;
  }
  try {
    return fs.statSync(getSessionFilePath()).mtimeMs;
  } catch {
    return undefined;
  }
}

export function shouldMicroCompact(options: {
  now: number;
  lastActivity: number | undefined;
  gapMs: number;
}): boolean {
  const { now, lastActivity, gapMs } = options;
  // An unknown last activity makes the subtraction NaN, which is never >= the
  // gap, so a session with nothing to measure from simply does not fire.
  return now - (lastActivity as number) >= gapMs;
}

export function isCacheCold(now: number = Date.now()): boolean {
  return shouldMicroCompact({
    now,
    lastActivity: lastActivityAt(),
    gapMs: cacheGapMs(),
  });
}

export interface MicroCompactResult {
  history: ChatHistoryItem[];
  clearedResults: number;
  droppedChars: number;
}

function contentLength(item: ChatHistoryItem): number {
  const message = item.message as { content?: unknown; role?: string };
  if (typeof message?.content === "string") {
    return message.content.length;
  }
  if (Array.isArray(message?.content)) {
    return message.content.reduce<number>((total, part) => {
      const text = (part as { text?: unknown })?.text;
      return total + (typeof text === "string" ? text.length : 0);
    }, 0);
  }
  return 0;
}

function clearedItem(item: ChatHistoryItem): ChatHistoryItem {
  // Both content shapes end at the marker. An array held text parts and images,
  // and the images go with them - what is being dropped is the bulk.
  return {
    ...item,
    message: {
      ...(item.message as object),
      content: CLEARED_TOOL_RESULT_CONTENT,
    } as ChatHistoryItem["message"],
  };
}

/**
 * Drops the bulk of the tool results that belong to earlier turns and leaves the
 * message, the tool call and the tool result id in place, because a result without
 * its call is not a history the API accepts. At least one message always survives:
 * the last turn is out of reach, and a history with nothing before it is returned
 * untouched.
 */
export function microCompactHistory(
  history: ChatHistoryItem[],
): MicroCompactResult {
  const lastUserIndex = history.reduce(
    (found, item, index) =>
      (item.message as { role?: string })?.role === "user" ? index : found,
    -1,
  );
  if (lastUserIndex <= 0) {
    return { history, clearedResults: 0, droppedChars: 0 };
  }

  let clearedResults = 0;
  let droppedChars = 0;
  const result = history.map((item, index) => {
    if (index >= lastUserIndex) {
      return item;
    }
    const role = (item.message as { role?: string })?.role;
    if (role !== "tool") {
      return item;
    }
    if (
      (item.message as { tool_call_id?: unknown })?.tool_call_id === undefined
    ) {
      return item;
    }
    const length = contentLength(item);
    if (length === 0) {
      return item;
    }
    clearedResults += 1;
    droppedChars += length - CLEARED_TOOL_RESULT_CONTENT.length;
    return clearedItem(item);
  });

  return { history: result, clearedResults, droppedChars };
}
