/**
 * What the provider did with the prefix on the last request.
 *
 * The session-wide hit ratio is already on screen, and it is an average: it
 * cannot say that this request re-read everything because the tool list moved
 * one round ago. The verdict for the last request exists in the log line, which
 * is the one place a user does not read while working, so this holds the one
 * fact worth showing - the state, and when it is not `full`, the fields that
 * moved - plus the ratio and, when a break was reported, the file that holds the
 * diff.
 */
import type { CachePrefixState } from "./prefixState.js";

export interface LastRequestCacheState {
  state: CachePrefixState;
  reasons: readonly string[];
  /** Share of the prompt the provider already had, 0..1. */
  hitRate: number;
  /** Where the break report was written, when one was. */
  reportPath?: string;
}

let lastState: LastRequestCacheState | undefined;

export function rememberLastRequestCacheState(
  state: LastRequestCacheState,
): void {
  lastState = state;
}

export function getLastRequestCacheState(): LastRequestCacheState | undefined {
  return lastState;
}

export function forgetLastRequestCacheState(): void {
  lastState = undefined;
}

/**
 * The segment the status bar shows, or undefined when there is nothing to say:
 * a prefix that stayed put is the normal case, and a line about it every turn
 * would be noise. The state word carries the reasons, because "invalidated"
 * alone is not actionable while "invalidated: tools" is.
 */
export function cacheStateText(
  state: LastRequestCacheState | undefined,
  labels: { states: Record<CachePrefixState, string>; prefix: string },
): string | undefined {
  if (!state || state.state === "full") return undefined;

  const word = labels.states[state.state] ?? state.state;
  const reasons =
    state.reasons.length > 0 ? `: ${state.reasons.join(", ")}` : "";
  return `${labels.prefix} ${word}${reasons}`;
}
