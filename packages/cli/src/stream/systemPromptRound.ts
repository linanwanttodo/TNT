import { describeSystemMessageTextChange } from "../agent/systemMessage.js";

import { decideSystemPrompt } from "./systemPromptPolicy.js";

/**
 * The system prompt is the head of every cached prefix, so a change to it is
 * not a copy edit: it decides whether this round appends a second system
 * message, rewrites the field, or leaves the prefix alone. The policy for that
 * choice lives in `systemPromptPolicy.ts`; this module owns the state the
 * change moves - what the request sends, which updates ride after it, and what
 * the next round compares against.
 *
 * The state is mutated in place because its lifetime is the turn's, not the
 * round's: each round reads the same object, so the loop never has to carry
 * three locals and write them back in the same order.
 */

export interface SystemPromptRoundState {
  /** The text the previous round compared against, undefined before the first. */
  previous?: string;
  /** The system field the request keeps sending, set by the last rewrite. */
  request?: string;
  /** In-history updates appended since that rewrite. */
  updates: string[];
}

export interface AdvanceSystemPromptInput {
  readonly state: SystemPromptRoundState;
  readonly next: string;
  readonly modelName: string;
  readonly supportsInHistoryUpdate?: boolean;
  readonly carriesInHistory: boolean;
}

export interface AdvancedSystemPrompt {
  /** What this request sends as its system field. */
  readonly systemMessage: string;
  /** Warnings the caller should log, already worded for the log. */
  readonly warnings: readonly string[];
}

export function advanceSystemPrompt(
  input: AdvanceSystemPromptInput,
): AdvancedSystemPrompt {
  const { state, next, modelName } = input;
  const decision = decideSystemPrompt({
    previous: state.previous,
    next,
    supportsInHistoryUpdate: input.supportsInHistoryUpdate,
    carriesInHistory: input.carriesInHistory,
    startsSeries: state.previous === undefined,
  });

  const warnings: string[] = [];

  if (decision.action === "append" && decision.appendedPrompt) {
    if (decision.forcesUnsupportedDialect) {
      warnings.push(
        `Appending the changed system prompt for ${modelName}: this endpoint is not known to carry a second system message, so the update may be dropped by the provider.`,
      );
    }
    // A fresh array, not a push: a header remembered from the previous request
    // must keep describing the updates that request actually sent.
    state.updates = [...state.updates, decision.appendedPrompt];
  } else if (decision.action === "rewrite") {
    state.updates = [];
    state.request = next;
    // Named from the bytes that are actually about to be sent, so the line
    // cannot disagree with what the provider has to rebill.
    const moved = describeSystemMessageTextChange(state.previous ?? "", next);
    if (moved) {
      warnings.push(
        `System prompt rewritten, cached tokens rebilled: ${moved}`,
      );
    }
  }

  state.previous = next;

  return {
    systemMessage: state.request ?? next,
    warnings,
  };
}
