import type { Usage } from "core/index.js";
import { calculateRequestCost } from "core/llm/utils/calculateRequestCost.js";

import { trackSessionUsage } from "../session/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { logger } from "../utils/logger.js";

function detectProvider(modelName: string): string {
  const normalized = modelName.toLowerCase();
  if (normalized.includes("gpt") || normalized.includes("openai")) {
    return "openai";
  }
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "anthropic";
  }
  // Default to anthropic for backward compatibility
  return "anthropic";
}

// Simple fallback cost calculation for unknown models
function calculateFallbackCost(
  inputTokens: number,
  outputTokens: number,
): number {
  // Default pricing: $1/MTok input, $2/MTok output
  return (inputTokens * 1 + outputTokens * 2) / 1_000_000;
}

/**
 * The adapters fold every provider into one usage shape, but a request that came
 * through core can still carry only the OpenAI spelling of a cache hit, so both
 * names are read here and a hit is not reported as a miss because of a field name.
 */
export function cacheTokensFrom(usage?: any): {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
} {
  const details = usage?.prompt_tokens_details;
  const cacheReadTokens = details?.cache_read_tokens ?? details?.cached_tokens;
  const cacheWriteTokens = details?.cache_write_tokens;
  return {
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}

// Helper function to record telemetry
export function recordStreamTelemetry(options: {
  requestStartTime: number;
  responseEndTime: number;
  inputTokens: number;
  outputTokens: number;
  model: any;
  tools?: any[];
  fullUsage?: any;
  /**
   * Compaction and title requests carry their own prefix, so they do not count
   * toward this session's cold-start attribution.
   */
  requestKind?: "turn" | "compaction";
}): number {
  const {
    requestStartTime,
    responseEndTime,
    inputTokens,
    outputTokens,
    model,
    tools,
    fullUsage,
    requestKind = "turn",
  } = options;
  const totalDuration = responseEndTime - requestStartTime;

  // Calculate cost using comprehensive pricing that includes caching
  let cost: number;
  let usage: Usage;
  let unpriced = false;
  const cacheTokens = cacheTokensFrom(fullUsage);

  if (fullUsage) {
    // Transform API usage format to Usage interface
    usage = {
      promptTokens: fullUsage.prompt_tokens,
      completionTokens: fullUsage.completion_tokens,
      promptTokensDetails: fullUsage.prompt_tokens_details
        ? {
            cachedTokens: cacheTokens.cacheReadTokens,
            cacheWriteTokens: cacheTokens.cacheWriteTokens,
          }
        : undefined,
      completionTokensDetails: fullUsage.completion_tokens_details
        ? {
            reasoningTokens:
              fullUsage.completion_tokens_details.reasoning_tokens,
          }
        : undefined,
    };

    // Detect provider and calculate cost
    const provider = detectProvider(model.model);
    const costBreakdown = calculateRequestCost(provider, model.model, usage);

    if (costBreakdown) {
      cost = costBreakdown.cost;
    } else {
      // The model has no price in the table. A number invented from a made-up
      // rate would be read as a measurement, so the total stays short and the
      // session counts the request instead.
      unpriced = true;
      cost = 0;
      logger.debug("No price for this model; its cost is unknown", {
        model: model.model,
      });
    }
  } else {
    // Fallback when fullUsage not available: an estimate is all there is, and
    // it is named as one by not being a model price.
    usage = {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
    };
    cost = calculateFallbackCost(inputTokens, outputTokens);
  }

  // Use tokens from fullUsage if available, otherwise use the passed params
  const actualInputTokens = fullUsage?.prompt_tokens ?? inputTokens;
  const actualOutputTokens = fullUsage?.completion_tokens ?? outputTokens;

  telemetryService.recordTokenUsage(actualInputTokens, "input", model.model);
  telemetryService.recordTokenUsage(actualOutputTokens, "output", model.model);

  // Record cache tokens if available
  if (cacheTokens.cacheReadTokens) {
    telemetryService.recordTokenUsage(
      cacheTokens.cacheReadTokens,
      "cacheRead",
      model.model,
    );
  }
  if (cacheTokens.cacheWriteTokens) {
    telemetryService.recordTokenUsage(
      cacheTokens.cacheWriteTokens,
      "cacheCreation",
      model.model,
    );
  }

  if (!unpriced) {
    telemetryService.recordCost(cost, model.model);
  }
  trackSessionUsage(cost, usage, requestKind, unpriced);

  telemetryService.recordResponseTime(
    totalDuration,
    model.model,
    "total_response_time",
    (tools?.length || 0) > 0,
  );

  telemetryService.logApiRequest({
    model: model.model,
    durationMs: totalDuration,
    success: true,
    inputTokens: actualInputTokens,
    outputTokens: actualOutputTokens,
    costUsd: cost,
  });

  return cost;
}

/**
 * Processes tool calls by validating and preprocessing them
 * @param toolCalls - The raw tool calls from the LLM
 * @param callbacks - Optional callbacks for notifying of events
 * @returns - Preprocessed tool calls that are ready for execution
 */
