import { clearSectionBaselines } from "./systemMessageReinjection.js";
import type { SystemPromptRoundState } from "./systemPromptRound.js";

/**
 * The system prompt series outlives the turn that started it.
 *
 * The system field and the updates appended behind it are the bytes the
 * provider has cached, and every later request replays them, so a state that
 * reset with each turn would make the first round of every new turn see
 * `previous === undefined`, decide "rewrite", clear the accumulated updates
 * from the wire and re-bill the whole head. The state therefore lives in a
 * session-scoped registry keyed by the same prompt cache key the requests
 * share, and `createTurnState` borrows the entry instead of minting one.
 *
 * A delegated run overrides the system message but shares the parent's cache
 * key, so its series gets its own entry: borrowing the parent's would corrupt
 * both directions - the child's first round would rewrite the parent's
 * remembered head, and the parent's next turn would then rewrite again. The
 * full override text keys the entry, which is bounded in practice by the
 * number of distinct agent definitions.
 */
const MAX_SERIES_ENTRIES = 32;
const seriesStates = new Map<string, SystemPromptRoundState>();

/**
 * Make room for a new entry. Clearing the whole map would drop the live
 * conversation's series with the stale ones and re-bill its cached head, so
 * only one entry goes: the oldest one nothing has read recently. Reads and
 * writes refresh an entry's position, so the conversation making rounds stays
 * at the far end of the map while a delegated run that finished long ago is
 * what gets evicted; the caller's own key is skipped outright.
 */
function evictOneEntry(cacheKey: string, entryKey: string): void {
  for (const key of seriesStates.keys()) {
    if (
      key === entryKey ||
      key === cacheKey ||
      key.startsWith(`${cacheKey}::run::`)
    ) {
      continue;
    }
    seriesStates.delete(key);
    return;
  }
}

export function systemPromptSeriesState(
  cacheKey = "default",
  overrideSystemMessage?: string,
): SystemPromptRoundState {
  const key = overrideSystemMessage
    ? `${cacheKey}::run::${overrideSystemMessage}`
    : cacheKey;
  let state = seriesStates.get(key);
  if (state) {
    // Refresh the LRU position: the conversation making rounds must look
    // newer than entries nobody has touched since.
    seriesStates.delete(key);
  } else {
    if (seriesStates.size >= MAX_SERIES_ENTRIES) {
      evictOneEntry(cacheKey, key);
    }
    state = { updates: [] };
  }
  seriesStates.set(key, state);
  return state;
}

/**
 * Drop the per-section facts of one series, after a rollback or a history
 * edit: the window the next round shows the model no longer contains the
 * messages the section baselines were measured against. Idempotent, and safe
 * to call for a series that never planned sections.
 */
export function clearSeriesSectionBaselines(
  cacheKey = "default",
  overrideSystemMessage?: string,
): void {
  const key = overrideSystemMessage
    ? `${cacheKey}::run::${overrideSystemMessage}`
    : cacheKey;
  const state = seriesStates.get(key);
  if (state?.sections) {
    clearSectionBaselines(state.sections);
  }
}

/**
 * Drop the series state, e.g. when the session closes or a compaction or
 * explicit reset makes the remembered bytes stale. The next round starts a new
 * series with a rewrite, which is the honest verdict then.
 */
export function resetSystemPromptSeries(cacheKey = "default"): void {
  for (const key of seriesStates.keys()) {
    if (key === cacheKey || key.startsWith(`${cacheKey}::run::`)) {
      seriesStates.delete(key);
    }
  }
}
