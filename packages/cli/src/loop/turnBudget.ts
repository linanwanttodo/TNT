/**
 * Per-turn budget for the conversation loop.
 *
 * A turn has no round ceiling by default: the loop follows the model for as
 * long as it keeps asking for tools, and ends on an actual ending - the model
 * replying without one, the user aborting, or one of the safeguards below. A
 * caller can still ask for a ceiling (the CLI's `--max-steps`); it is honored
 * when given and absent otherwise.
 *
 * The safeguards that do bound a turn:
 *
 * - Repeated output: `loopDetector` ends a turn whose text starts repeating.
 * - Compaction failure: after a few consecutive compactions that do not
 *   shrink history, automatic compaction stops for the turn.
 * - Unrecoverable context: a conversation that no longer fits and cannot be
 *   compacted ends instead of looping on refusals.
 * - Wall clock: headless runs carry a deadline (`--request-timeout`, 300s by
 *   default) that aborts the whole turn.
 *
 * Repeating one tool call with identical arguments is not a bound: the
 * repeat-call guard advises the model so it can change tack, and the turn
 * keeps running.
 *
 * There is deliberately no "diminishing returns" rule here. An earlier version
 * ended the turn after three consecutive rounds whose completion_tokens stayed
 * under 500, but that is what a normal tool round looks like: the model emits a
 * sentence and a tool call, and the tool may read a large file. The rule
 * therefore killed the turn after three files no matter how much context was
 * left.
 */

export interface TurnBudgetLimits {
  /**
   * Optional ceiling on model rounds within one user turn. Unset by default,
   * so the loop keeps going while the model asks for tools. When set (the CLI
   * passes `--max-steps`), reaching it ends the turn with `max_steps` rather
   * than throwing, so a runaway loop degrades into a visible partial answer.
   */
  maxSteps?: number;

  /**
   * Consecutive failed compaction attempts before automatic compaction stops
   * for the rest of the turn.
   */
  maxConsecutiveCompactionFailures: number;

  /**
   * A compaction that shrinks the history by less than this fraction is
   * treated as not worth the model call it just spent. Set low deliberately:
   * the purpose is to catch a compaction that did nothing at all, not to
   * second-guess one that helped a little.
   */
  compactionMinReductionRatio: number;
}

export const DEFAULT_TURN_BUDGET_LIMITS: TurnBudgetLimits = {
  maxConsecutiveCompactionFailures: 3,
  compactionMinReductionRatio: 0.01,
};

/**
 * Mutable tally for one user turn. Created once per turn and threaded through
 * the loop so termination decisions read the same numbers the loop maintains
 * instead of re-deriving them from history.
 */
export class TurnBudget {
  readonly limits: TurnBudgetLimits;

  /** Model rounds completed so far, including rounds that only compacted. */
  stepsDone = 0;

  /** Consecutive compaction attempts that failed to shrink the history. */
  private consecutiveCompactionFailures = 0;

  constructor(limits: Partial<TurnBudgetLimits> = {}) {
    this.limits = { ...DEFAULT_TURN_BUDGET_LIMITS, ...limits };
  }

  /** True once an explicitly configured round ceiling is reached. */
  get stepsExhausted(): boolean {
    return (
      this.limits.maxSteps !== undefined &&
      this.stepsDone >= this.limits.maxSteps
    );
  }

  /** True once automatic compaction has failed too many times in a row. */
  get compactionCircuitOpen(): boolean {
    return (
      this.consecutiveCompactionFailures >=
      this.limits.maxConsecutiveCompactionFailures
    );
  }

  /**
   * Record one completed round. A round is progress by definition: the loop
   * only continues when the model asked for a tool, and the tool result is
   * what moves the task forward.
   */
  recordStep(): TurnBudgetState {
    this.stepsDone += 1;
    return this.stepsExhausted ? "steps_exhausted" : "ok";
  }

  /**
   * Record a compaction outcome and report whether it actually paid for
   * itself. A compaction that barely shrank the history is treated the same as
   * one that failed, because both leave the next round just as expensive.
   */
  recordCompaction(reductionRatio: number | undefined): boolean {
    const worthwhile =
      reductionRatio !== undefined &&
      reductionRatio >= this.limits.compactionMinReductionRatio;

    if (worthwhile) {
      this.consecutiveCompactionFailures = 0;
    } else {
      this.consecutiveCompactionFailures += 1;
    }

    return worthwhile;
  }

  /** Reset every per-turn counter. A new user turn starts from zero. */
  resetForNewTurn(): void {
    this.stepsDone = 0;
    this.consecutiveCompactionFailures = 0;
  }
}

export type TurnBudgetState = "ok" | "steps_exhausted";
