export type SystemPromptAction = "keep" | "rewrite" | "append";

export interface SystemPromptDecisionInput {
  readonly previous?: string;
  readonly next: string;
  readonly supportsInHistoryUpdate: boolean;
  readonly startsSeries: boolean;
}

export interface SystemPromptDecision {
  readonly action: SystemPromptAction;
  readonly appendedPrompt?: string;
}

export function decideSystemPrompt(
  input: SystemPromptDecisionInput,
): SystemPromptDecision {
  const { previous, next, supportsInHistoryUpdate, startsSeries } = input;

  if (startsSeries || previous === undefined) {
    return { action: "rewrite" };
  }

  if (previous === next) {
    return { action: "keep" };
  }

  if (next === "" || !supportsInHistoryUpdate) {
    return { action: "rewrite" };
  }

  return { action: "append", appendedPrompt: next };
}
