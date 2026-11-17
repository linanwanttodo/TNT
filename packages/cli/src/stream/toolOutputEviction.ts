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
 * same history and the cache prefix only moves at the tail — as long as the
 * evicted set itself does not grow. Growth is the caller's decision (see
 * `appliedEvicted`), because every new position the set swallows moves the
 * cached prefix and re-pays the tail at full price on a warm cache.
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
    chars += contentChars(item);
  }
  return Math.ceil(chars / 4);
}

function contentChars(item: ChatHistoryItem): number {
  const content = item.message.content;
  if (typeof content === "string") {
    return content.length;
  }
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content) {
      if (part.type === "text" && part.text) {
        total += part.text.length;
      }
    }
    return total;
  }
  return 0;
}

export interface EvictionOptions {
  history: ChatHistoryItem[];
  /** The model's context window, which caps how late eviction may trigger. */
  contextWindow: number;
  /** The provider's own measurement of the last request, when known. */
  measuredInputTokens?: number;
  /** How many of the newest tool results stay verbatim. */
  keepRecent?: number;
  /**
   * How many of the oldest tool results are already placeholders in the prefix
   * the provider has cached. Positions below it are re-placeholdered to the
   * same bytes either way; the set only grows past it when `allowGrowth` says
   * so, because each newly swallowed position moves the cached prefix.
   */
  appliedEvicted?: number;
  /**
   * Whether the evicted set may grow this round. The caller gates growth on
   * the cache's temperature: a cold prefix re-pays nothing, a warm one re-pays
   * the tail at full price.
   */
  allowGrowth?: boolean;
}

export interface EvictionResult {
  history: ChatHistoryItem[];
  /** How many tool results this round carries as the placeholder. */
  evicted: number;
  /** Chars the results newly swallowed this round carried. */
  newlyEvictedChars: number;
  /** Chars after the last placeholder: what a moved prefix re-pays in full. */
  movingWindowChars: number;
}

/**
 * The warm-cache criterion for letting the evicted set grow. Growth saves the
 * newly swallowed bytes re-read at the provider's cache discount on every
 * later round, and costs the moving window once at full price because the
 * rewrite makes the provider re-read everything past the new break. With no
 * discount there is no premium to protect, so growth is always worth it.
 */
export function shouldApplyWarmEviction(options: {
  newlyEvictedTokens: number;
  movingWindowTokens: number;
  cacheReadDiscount: number;
}): boolean {
  const { newlyEvictedTokens, movingWindowTokens, cacheReadDiscount } = options;
  if (cacheReadDiscount <= 0) {
    return true;
  }
  return (
    newlyEvictedTokens * cacheReadDiscount >
    movingWindowTokens * (1 - cacheReadDiscount)
  );
}

/**
 * Returns the history to send: unchanged while it is under the eviction
 * threshold, otherwise a copy where every tool result older than the newest
 * `keepRecent` carries the placeholder instead of its original bytes — except
 * that the set never grows past `appliedEvicted` unless `allowGrowth` says so.
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
    return {
      history,
      evicted: 0,
      newlyEvictedChars: 0,
      movingWindowChars: 0,
    };
  }

  const toolResultIndexes: number[] = [];
  for (let i = 0; i < history.length; i += 1) {
    if (history[i].message.role === "tool") toolResultIndexes.push(i);
  }
  // Everything strictly older than the newest `keepRecent` results is dead
  // weight. With fewer than one evictable result there is nothing to do.
  const target = toolResultIndexes.length - keepRecent;
  const appliedEvicted = options.appliedEvicted ?? 0;
  const evictCount =
    options.allowGrowth === false
      ? Math.min(Math.max(target, 0), appliedEvicted)
      : Math.max(target, 0);
  if (evictCount <= 0) {
    return {
      history,
      evicted: 0,
      newlyEvictedChars: 0,
      movingWindowChars: 0,
    };
  }
  const evictSet = new Set(toolResultIndexes.slice(0, evictCount));
  const lastEvictedIndex = toolResultIndexes[evictCount - 1];

  let evicted = 0;
  let evictedOrdinal = 0;
  let newlyEvictedChars = 0;
  const next = history.map((item, index) => {
    if (!evictSet.has(index)) return item;
    evicted += 1;
    evictedOrdinal += 1;
    if (evictedOrdinal > appliedEvicted) {
      newlyEvictedChars += contentChars(item);
    }
    return {
      ...item,
      message: { ...item.message, content: EVICTION_PLACEHOLDER },
    };
  });
  let movingWindowChars = 0;
  for (let i = lastEvictedIndex + 1; i < history.length; i += 1) {
    movingWindowChars += contentChars(history[i]);
  }
  return { history: next, evicted, newlyEvictedChars, movingWindowChars };
}
