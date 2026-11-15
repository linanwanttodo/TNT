import type { ChatHistoryItem } from "core/index.js";

import { parseEnvNumber } from "../utils/truncateOutput.js";

/**
 * Old tool results are the one part of the history that only ever grows: a
 * single Read can add ~25k tokens and nothing shrinks them again, so a long
 * session re-sends hundreds of thousands of tokens of dead output on every
 * request. The reference clients bound this by evicting: past a threshold,
 * every tool result older than the most recent few is replaced by a
 * placeholder in what the request carries. The original stays in the
 * transcript, which wrote it when the result arrived, so nothing is lost —
 * resuming rebuilds from the transcript and the next round evicts again.
 *
 * The eviction is position-deterministic (keep the newest N, evict the rest),
 * so once a round has evicted, later rounds produce the same bytes for the
 * same history and the cache prefix only moves at the tail.
 */

export const EVICTION_PLACEHOLDER = "[Old tool result content cleared]";

/** Evict once the request would carry at least this many tokens. */
const DEFAULT_EVICTION_TOKENS = 100_000;
/** The most recent tool results that survive an eviction round. */
const DEFAULT_KEEP_RECENT = 5;
/** No window may push the trigger past 40% of itself. */
const EVICTION_WINDOW_RATIO = 0.4;

export function evictionTokenThreshold(contextWindow: number): number {
  const absolute = parseEnvNumber(
    process.env.TNT_TOOL_EVICTION_TOKENS,
    DEFAULT_EVICTION_TOKENS,
  );
  return Math.min(absolute, contextWindow * EVICTION_WINDOW_RATIO);
}

/** Rough token size of the history: chars/4. The gate does not need precision. */
function estimateHistoryTokens(history: readonly ChatHistoryItem[]): number {
  let chars = 0;
  for (const item of history) {
    const content = item.message.content;
    if (typeof content === "string") {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text" && part.text) chars += part.text.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

export interface EvictionOptions {
  history: ChatHistoryItem[];
  /** The model's context window, which caps how late eviction may trigger. */
  contextWindow: number;
  /** The provider's own measurement of the last request, when known. */
  measuredInputTokens?: number;
  /** How many of the newest tool results stay verbatim. */
  keepRecent?: number;
}

export interface EvictionResult {
  history: ChatHistoryItem[];
  /** How many tool results this round replaced with the placeholder. */
  evicted: number;
}

/**
 * Returns the history to send: unchanged while it is under the eviction
 * threshold, otherwise a copy where every tool result older than the newest
 * `keepRecent` carries the placeholder instead of its original bytes.
 */
export function evictOldToolResults(options: EvictionOptions): EvictionResult {
  const { history, contextWindow, measuredInputTokens } = options;
  const keepRecent =
    options.keepRecent ??
    parseEnvNumber(process.env.TNT_TOOL_EVICTION_KEEP, DEFAULT_KEEP_RECENT);

  const estimate = Math.max(
    measuredInputTokens ?? 0,
    estimateHistoryTokens(history),
  );
  if (estimate < evictionTokenThreshold(contextWindow)) {
    return { history, evicted: 0 };
  }

  const toolResultIndexes: number[] = [];
  for (let i = 0; i < history.length; i += 1) {
    if (history[i].message.role === "tool") toolResultIndexes.push(i);
  }
  // Everything strictly older than the newest `keepRecent` results is dead
  // weight. With fewer than one evictable result there is nothing to do.
  const evictCount = toolResultIndexes.length - keepRecent;
  if (evictCount <= 0) {
    return { history, evicted: 0 };
  }
  const evictSet = new Set(toolResultIndexes.slice(0, evictCount));

  let evicted = 0;
  const next = history.map((item, index) => {
    if (!evictSet.has(index)) return item;
    evicted += 1;
    return {
      ...item,
      message: { ...item.message, content: EVICTION_PLACEHOLDER },
    };
  });
  return { history: next, evicted };
}
