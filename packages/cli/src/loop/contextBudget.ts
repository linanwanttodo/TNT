import { logger } from "../utils/logger.js";

/**
 * How much of the window has to be left before the model is told. One notice
 * per descent is enough: the point is that it finishes the step it is in
 * cleanly, not that it watches a counter.
 */
export const CONTEXT_BUDGET_FRACTION = 0.2;

/**
 * The remaining-context notice, measured from the request size the provider
 * reported rather than from a local tokenizer pass over the whole history. The
 * provider's number is what actually filled the window, and the estimate it
 * replaces was both slower and wrong in the direction that matters.
 */
export class ContextBudgetTracker {
  private lastPromptTokens: number | undefined;
  private warned = false;

  recordRequest(promptTokens: number | undefined): void {
    if (typeof promptTokens === "number" && promptTokens > 0) {
      this.lastPromptTokens = promptTokens;
    }
  }

  /**
   * The notice to append to the next tool result, or undefined. A window that
   * is unknown (a model without a configured context length) or a request that
   * never reported usage say nothing, because a made-up number would be acted
   * on.
   */
  reminder(contextLength: number | undefined): string | undefined {
    if (!contextLength || contextLength <= 0) return undefined;
    if (this.lastPromptTokens === undefined) return undefined;

    const remaining = contextLength - this.lastPromptTokens;
    const threshold = Math.floor(contextLength * CONTEXT_BUDGET_FRACTION);
    if (remaining > threshold) {
      // Recovered (a compaction, usually): the next descent is worth telling.
      this.warned = false;
      return undefined;
    }
    if (this.warned) return undefined;

    this.warned = true;
    logger.debug("Context budget notice raised", {
      remaining,
      contextLength,
    });
    return `About ${remaining.toLocaleString("en-US")} tokens of this model's ${contextLength.toLocaleString("en-US")} window are left, measured from the last request. Finish the step you are in cleanly, and say what is unfinished if the turn has to end.`;
  }
}
