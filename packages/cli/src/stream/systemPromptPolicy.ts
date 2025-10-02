export type SystemPromptAction = "keep" | "rewrite" | "append";

export interface SystemPromptDecisionInput {
  readonly previous?: string;
  readonly next: string;
  /**
   * What the configuration claims. Left undefined, the decision falls to what the
   * adapter declares, which is the difference between an instruction that is
   * delivered and one that is lifted into a field and dropped.
   */
  readonly supportsInHistoryUpdate?: boolean;
  /** What the adapter says about this dialect. Unknown counts as cannot carry. */
  readonly carriesInHistory?: boolean;
  readonly startsSeries: boolean;
}

export interface SystemPromptDecision {
  readonly action: SystemPromptAction;
  readonly appendedPrompt?: string;
  /**
   * The configuration asked for an append on a dialect that does not declare it
   * can carry one. The append still happens - the user asked for it - but the
   * caller says out loud that the provider is expected to drop the message.
   */
  readonly forcesUnsupportedDialect?: boolean;
}

export function decideSystemPrompt(
  input: SystemPromptDecisionInput,
): SystemPromptDecision {
  const {
    previous,
    next,
    supportsInHistoryUpdate,
    carriesInHistory,
    startsSeries,
  } = input;
  const carries = supportsInHistoryUpdate ?? carriesInHistory === true;

  if (startsSeries || previous === undefined) {
    return { action: "rewrite" };
  }

  if (previous === next) {
    return { action: "keep" };
  }

  if (next === "" || !carries) {
    return { action: "rewrite" };
  }

  const forces = supportsInHistoryUpdate === true && carriesInHistory !== true;
  return {
    action: "append",
    appendedPrompt: next,
    // Absent rather than false, so a caller that compares the whole decision is
    // not changed by an answer it never asked for.
    ...(forces ? { forcesUnsupportedDialect: true } : {}),
  };
}
