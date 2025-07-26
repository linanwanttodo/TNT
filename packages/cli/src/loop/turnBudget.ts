/**
 * Per-turn budget for the conversation loop.
 *
 * The loop must terminate even when the model keeps requesting tool calls
 * forever, so the caller gets a ceiling it can tune rather than an unbounded
 * walk. The ceiling counts every model round of one user turn, including the
 * rounds a compaction checkpoint adds, because those cost the same tokens and
 * the same wall clock as any other round.
 */

export interface TurnBudgetLimits {
  /**
   * Hard ceiling on model rounds within one user turn. Reaching it ends the
   * turn with `max_steps` rather than throwing, so a runaway loop degrades
   * into a visible partial answer.
   */
  maxSteps: number;

  /**
   * Rounds without new effective content, each adding fewer than
   * `diminishingTokenThreshold` tokens, before the turn is considered stuck.
   */
  diminishingReturnsThreshold: number;

  /** Token delta below which a round counts as adding no effective content. */
  diminishingTokenThreshold: number;

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
  diminishingReturnsThreshold: 3,
  diminishingTokenThreshold: 500,
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

  /** Consecutive rounds that added fewer than the token threshold. */
  private diminishingRounds = 0;

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

  /** True once enough consecutive rounds have produced no real progress. */
  get diminishingRoundsStuck(): boolean {
    return this.diminishingRounds >= this.limits.diminishingReturnsThreshold;
  }

  /**
   * Record one completed round and report whether the turn has stalled, either
   * because the ceiling was hit or because progress stopped.
   */
  recordStep(tokensAdded: number): TurnBudgetState {
    this.stepsDone += 1;

    if (tokensAdded > this.limits.diminishingTokenThreshold) {
      this.diminishingRounds = 0;
    } else {
      this.diminishingRounds += 1;
    }

    if (this.stepsExhausted) {
      return "steps_exhausted";
    }
    if (this.diminishingRoundsStuck) {
      return "diminishing_returns";
    }
    return "ok";
  }

  /** Clear the diminishing-returns tally after the model made real progress. */
  resetDiminishingRounds(): void {
    this.diminishingRounds = 0;
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
    this.diminishingRounds = 0;
    this.consecutiveCompactionFailures = 0;
  }
}

export type TurnBudgetState = "ok" | "steps_exhausted" | "diminishing_returns";
