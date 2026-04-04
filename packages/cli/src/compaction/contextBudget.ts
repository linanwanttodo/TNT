import type { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";

import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import {
  countChatHistoryTokens,
  getModelContextLimit,
  getModelMaxTokens,
} from "../utils/tokenizer.js";

import { measuredRequestFor } from "./measuredContext.js";

/**
 * How much room this turn has left, said once it matters.
 *
 * The model cannot see its window: it decides whether to read another file or
 * work from what it has, and the only signal in front of it is the length of the
 * text. The note goes into the newest user message, after the cached prefix, so
 * it costs one line and never rewrites the part a provider caches.
 *
 * It stays quiet below the threshold on purpose. A reminder on every turn is
 * noise the model learns to skip, and counting the whole history on every turn is
 * work nobody needs when the provider already reported the number for the last
 * request under this prefix.
 */
const SPEAK_AT = 0.75;

export interface BudgetInput {
  /** The provider's own count for the previous request under this prefix. */
  measured?: number;
  /** Exact local count, called only once the cheap check says it may matter. */
  count: () => number;
  /** The model's context window. */
  limit: number;
  /** Room kept for this turn's reply, so the note cannot invite a refusal. */
  reserve: number;
}

export function budgetNoteFrom(input: BudgetInput): string | undefined {
  const usable = Math.max(0, input.limit - input.reserve);
  if (usable === 0) {
    return undefined;
  }
  const threshold = usable * SPEAK_AT;
  if (input.measured !== undefined && input.measured < threshold) {
    return undefined;
  }
  const used = input.count();
  if (used < threshold) {
    return undefined;
  }
  const left = Math.max(0, usable - used);
  return `Context budget: about ${rounded(used)} of ${rounded(
    usable,
  )} usable tokens are already in this conversation, leaving ${rounded(
    left,
  )}. Prefer working from what you have read and summarising it over reading more.`;
}

/** Rounded to the hundred, because the number is an estimate either way. */
function rounded(tokens: number): number {
  return Math.max(0, Math.round(tokens / 100) * 100);
}

/** The note for a real history and the model this turn will use. */
export function describeContextBudget(
  history: ChatHistoryItem[],
  model: ModelConfig,
): string | undefined {
  const measured = measuredRequestFor(currentPromptCacheKey())?.promptTokens;
  return budgetNoteFrom({
    measured,
    count: () => countChatHistoryTokens(history, model),
    limit: getModelContextLimit(model),
    reserve: getModelMaxTokens(model),
  });
}
