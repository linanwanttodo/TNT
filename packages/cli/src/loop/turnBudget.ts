/**
 * Per-turn budget for the conversation loop.
 *
 * The loop must terminate even when the model keeps requesting tool calls
 * forever, so the caller gets a ceiling it can tune rather than an unbounded
 * walk. The ceiling counts every model round of one user turn, including the
 * rounds a compaction checkpoint adds, because those cost the same tokens and
 * the same wall clock as any other round.
 *
 * There is deliberately no "diminishing returns" rule here. An earlier version
 * ended the turn after three consecutive rounds whose completion_tokens stayed
 * under 500, but that is what a normal tool round looks like: the model emits a
 * sentence and a tool call, and the tool may read a large file. The rule
 * therefore killed the turn after three files no matter how much context was
 * left. Gemini CLI and Claude Code bound a turn with the round ceiling and with
 * detection of actually repeated output or identical tool calls, so those are
 * the only two bounds kept here.
 */

export interface TurnBudgetLimits {
  /**
   * Hard ceiling on model rounds within one user turn. Reaching it ends the
   * turn with `max_steps` rather than throwing, so a runaway loop degrades
   * into a visible partial answer.
   */
  maxSteps: number;

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
  maxSteps: 128,
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

  /** True once the round ceiling is reached. */
  get stepsExhausted(): boolean {
    return this.stepsDone >= this.limits.maxSteps;
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
