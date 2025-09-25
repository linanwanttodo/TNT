/**
 * The provider's own measurement of one request, kept so that the next request
 * does not have to be counted from scratch. A local count of the whole history
 * is neither measured nor cheap, and it is the number that decides whether the
 * session compacts.
 */
export interface MeasuredRequest {
  /** Input tokens the provider reported for that request. */
  promptTokens: number;
  /** How many history items that request carried. */
  historyLength: number;
  /** The cache prefix that request was sent under. */
  prefixKey: string;
}

/**
 * Records are keyed by the prompt cache key, because that is exactly the
 * condition under which the number still describes a request: a new prefix means
 * a new system message or tool set, and the measurement belongs to the old one.
 * The key is per session, so several sessions in one process cannot read each
 * other's numbers. Bounded, because a server outlives any number of sessions.
 */
const MAX_RECORDS = 32;
const byPrefix = new Map<string, MeasuredRequest>();

export function recordMeasuredRequest(
  prefixKey: string,
  record: MeasuredRequest,
): void {
  if (byPrefix.size >= MAX_RECORDS && !byPrefix.has(prefixKey)) {
    const oldest = byPrefix.keys().next().value;
    if (oldest !== undefined) byPrefix.delete(oldest);
  }
  byPrefix.set(prefixKey, record);
}

export function measuredRequestFor(
  prefixKey: string | undefined,
): MeasuredRequest | undefined {
  if (!prefixKey) return undefined;
  return byPrefix.get(prefixKey);
}

/**
 * Keep the provider's own number for the request that just went out, when there
 * is one and when the prefix it went out under can be recognised again later.
 * A missing number is not a zero: recording zero would make the next request
 * look nearly empty and postpone compaction until the provider refuses it.
 */
export function noteMeasuredRequest(
  prefixKey: string | undefined,
  usage: { promptTokens?: number | string },
  context: { historyLength: number },
): void {
  if (!prefixKey) return;
  const promptTokens = Number(usage.promptTokens);
  if (!Number.isFinite(promptTokens) || promptTokens <= 0) return;

  recordMeasuredRequest(prefixKey, {
    promptTokens,
    historyLength: context.historyLength,
    prefixKey,
  });
}

/**
 * What the next request is expected to cost, or nothing when the measurement
 * cannot be trusted. `undefined` is the honest answer rather than a guess: the
 * caller falls back to counting the whole request, which is what it did before
 * anything was measured.
 */
export function measuredInputTokens(
  record: MeasuredRequest | undefined,
  current: {
    historyLength: number;
    prefixKey: string | undefined;
    /** Tokens of the items appended since the measured request. */
    tailTokens: number;
  },
): number | undefined {
  if (!record) return undefined;

  // A different prefix means a different request: the system message or the
  // tool set was rewritten (a mode switch does), so what was measured no longer
  // describes what would be sent.
  if (!current.prefixKey || current.prefixKey !== record.prefixKey) {
    return undefined;
  }

  // Fewer items than were measured means the history was rewritten underneath
  // the record - compaction, a rewind, a resumed branch.
  if (current.historyLength < record.historyLength) return undefined;

  return record.promptTokens + current.tailTokens;
}

/** Test seam: forget every measurement, so cases cannot leak into each other. */
export function clearMeasuredRequests(): void {
  byPrefix.clear();
}
