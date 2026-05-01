import { ContextBudgetTracker } from "../loop/contextBudget.js";
import { RepeatCallGuard } from "../loop/repeatCallGuard.js";
import { TerminalStopTracker } from "../loop/terminalStop.js";
import { TodoReminderTracker } from "../loop/todoReminder.js";
import { ToolFailureTracker } from "../loop/toolFailureTracker.js";
import { TurnBudget, type TurnBudgetLimits } from "../loop/turnBudget.js";

import type { SystemPromptRoundState } from "./systemPromptRound.js";

import { systemPromptSeriesState } from "./systemPromptSeries.js";

/**
 * Everything one user turn counts, and nothing that outlives it.
 *
 * The limit comes from configuration and the spend is recorded in the session,
 * but the counters reset with each prompt: a second message from the user is a
 * new turn, not a continuation of the first one's exhausted budget. Holding
 * them in one object makes that boundary explicit - the loop reads a decision
 * instead of threading six locals through every extracted phase. The boundary
 * is the `streamChatResponse` call: a new prompt builds a new state, so no
 * counter leaks from the previous answer.
 */
export interface TurnState {
  readonly budget: TurnBudget;
  readonly toolFailures: ToolFailureTracker;
  readonly terminalStops: TerminalStopTracker;
  readonly todoReminder: TodoReminderTracker;
  readonly contextBudget: ContextBudgetTracker;
  /** Advice for identical calls; never a reason to stop the turn. */
  readonly repeatCallGuard: RepeatCallGuard;
  /**
   * What the last round sent as the head of the prompt, and the updates that
   * ride after it. It cannot be rebuilt from the history: the Anthropic and
   * Gemini adapters lift only the first system message into their system
   * field, so the text the provider actually received lives here.
   */
  readonly systemPrompt: SystemPromptRoundState;

  /** False once this turn has issued its first request. */
  coldTurn: boolean;
  /** Set when the turn rewrote history since the last request. */
  historyRewritten: boolean;
  /** Set when any checkpoint (pre-API, post-tool, normal) compacted. */
  compactionOccurred: boolean;
  /** Count of length refusals already recovered from in this turn. */
  overflowRecoveries: number;
  /** Set by an overflow refusal, consumed by the next round's preparation. */
  forceNextCompaction: boolean;
}

export function createTurnState(
  limits?: Partial<TurnBudgetLimits>,
  promptCacheKey?: string,
  overrideSystemMessage?: string,
): TurnState {
  return {
    budget: new TurnBudget(limits),
    toolFailures: new ToolFailureTracker(),
    terminalStops: new TerminalStopTracker(),
    todoReminder: new TodoReminderTracker(),
    contextBudget: new ContextBudgetTracker(),
    repeatCallGuard: new RepeatCallGuard(),
    // Borrowed from the session-scoped series, not created here: the system
    // field and its in-history updates are the bytes the provider has cached,
    // so a new turn that reset them would rewrite the head and re-bill every
    // round of it. The cache key scopes the borrow to one conversation, and a
    // delegated run's own system message gets its own series so it cannot
    // corrupt the parent's; the default covers callers without a key (tests,
    // startup probes).
    systemPrompt: systemPromptSeriesState(
      promptCacheKey,
      overrideSystemMessage,
    ),
    coldTurn: true,
    historyRewritten: false,
    compactionOccurred: false,
    overflowRecoveries: 0,
    forceNextCompaction: false,
  };
}

/** Read the forced-compaction flag and clear it, so it applies to one round. */
export function takeForcedCompaction(state: TurnState): boolean {
  const forced = state.forceNextCompaction;
  state.forceNextCompaction = false;
  return forced;
}

/** Record that a checkpoint compacted, which also moves the cached prefix. */
export function noteCompaction(state: TurnState): void {
  state.compactionOccurred = true;
  state.historyRewritten = true;
}

/** Record that a request went out, which ends the cold-prefix case. */
export function noteRequestCompleted(state: TurnState): void {
  state.coldTurn = false;
  state.historyRewritten = false;
}

/**
 * Record one recovered length refusal and report whether the attempt budget is
 * spent. The counter only moves while attempts remain, so the refusal that
 * exhausts it still reports the number of recoveries already made.
 */
export function noteOverflowRecovery(
  state: TurnState,
  maxRecoveries: number,
): boolean {
  if (state.overflowRecoveries >= maxRecoveries) {
    return true;
  }
  state.overflowRecoveries += 1;
  state.forceNextCompaction = true;
  return false;
}
