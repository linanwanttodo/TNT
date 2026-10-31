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

export function systemPromptSeriesState(
  cacheKey = "default",
  overrideSystemMessage?: string,
): SystemPromptRoundState {
  const key = overrideSystemMessage
    ? `${cacheKey}::run::${overrideSystemMessage}`
    : cacheKey;
  let state = seriesStates.get(key);
  if (!state) {
    if (seriesStates.size >= MAX_SERIES_ENTRIES) {
      seriesStates.clear();
    }
    state = { updates: [] };
    seriesStates.set(key, state);
  }
  return state;
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
