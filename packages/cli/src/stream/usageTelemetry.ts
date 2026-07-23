import type { ModelConfig } from "@tnt/config-yaml";
import type { Usage } from "core/index.js";
import { calculateRequestCost } from "core/llm/utils/calculateRequestCost.js";
import type { ChatCompletionTool } from "openai/resources.mjs";

import {
  assessCacheBreak,
  forgetCacheRound,
  recallCacheRound,
  recordCacheRound,
  writeCacheBreakReport,
} from "../cache/cacheBreakReport.js";
import {
  cacheHitFloor,
  CACHE_HIT_TAIL_ROUNDS,
  meetsCacheHitFloor,
  tailCacheHitRate,
} from "../cache/cacheHitGuard.js";
import { rememberLastRequestCacheState } from "../cache/lastRequestCacheState.js";
import {
  attributeCacheMiss,
  COMPACTION_PREFIX_STATE,
  COLD_PREFIX_STATE,
  type CachePrefixVerdict,
} from "../cache/prefixState.js";
import type { RequestHeader } from "../cache/requestHeader.js";
import { trackSessionUsage } from "../session/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { logger } from "../utils/logger.js";

/**
 * The last rounds' hit rates per conversation, for the floor check. The break
 * detector asks whether one round dropped; this asks whether the tail stopped
 * reading the cache at all, which is the question a floor answers. Kept short
 * on purpose: an old cold round should not hold a recovered tail down.
 */
const cacheHitRates = new Map<string, number[]>();
/** The last turn round's cache hit ratio, for the status line. */
let lastRoundRate: number | undefined;
/** Conversations already reported, so a persistent miss warns once, not per turn. */
const reportedFloorMiss = new Set<string>();

function noteCacheHitRate(key: string, rate: number): void {
  const rates = cacheHitRates.get(key) ?? [];
  rates.push(rate);
  if (rates.length > CACHE_HIT_TAIL_ROUNDS) {
    rates.shift();
  }
  cacheHitRates.set(key, rates);
  if (rates.length < CACHE_HIT_TAIL_ROUNDS) {
    return;
  }

  if (meetsCacheHitFloor(rates)) {
    // Recovery is news the next time it breaks: a session that was fixed and
    // then regressed deserves its second warning.
    reportedFloorMiss.delete(key);
    return;
  }
  if (reportedFloorMiss.has(key)) {
    return;
  }
  reportedFloorMiss.add(key);
  logger.warn("Cache hit rate below floor", {
    floor: cacheHitFloor(),
    tailRate: Number((tailCacheHitRate(rates) ?? 0).toFixed(4)),
    rounds: CACHE_HIT_TAIL_ROUNDS,
    hint: "TNT_CACHE_HIT_FLOOR overrides the floor for a provider with different cache economics",
  });
}

function forgetCacheHitRates(key: string): void {
  cacheHitRates.delete(key);
  reportedFloorMiss.delete(key);
}

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

/**
 * The cache hit ratio of the last completed round, when the provider reported
 * cache activity for it. The status line reads this when no prefix verdict
 * exists, because a provider without prefix accounting still bills cache hits.
 */
export function lastRoundCacheRate(): number | undefined {
  return lastRoundRate;
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
 * Closes one request's books: stream telemetry is recorded, the provider usage
 * object is annotated in place with the model and the computed cost for the
 * session store, the per-request cache line is logged, a cache break is
 * assessed and reported to a file, the status-bar state is refreshed, and the
 * round is recorded so the next request is compared against it.
 *
 * The hit ratio is logged for every request rather than only the session
 * total, because the session total is an average over requests that may have
 * used entirely different prefixes. A zero here on an otherwise identical
 * second request is the signal that something in the prefix moved.
 */
export interface TurnUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  rounds: number;
}

let turnUsage: TurnUsageSnapshot | null = null;
let lastTurnUsage: TurnUsageSnapshot | null = null;

/** A user turn begins; the per-round ledger restarts. */
export function beginTurnUsage(): void {
  turnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    rounds: 0,
  };
}

/** One provider round inside the turn joins the ledger. */
function addRoundUsage(
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
  cacheWrite: number,
  cost: number,
): void {
  if (!turnUsage) {
    turnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      rounds: 0,
    };
  }
  turnUsage.inputTokens += inputTokens;
  turnUsage.outputTokens += outputTokens;
  turnUsage.cacheReadTokens += cacheRead;
  turnUsage.cacheWriteTokens += cacheWrite;
  turnUsage.cost += cost;
  turnUsage.rounds += 1;
}

/** The turn ended; the ledger is read once and cleared. */
export function endTurnUsage(): TurnUsageSnapshot | null {
  const snapshot = turnUsage;
  turnUsage = null;
  if (snapshot) lastTurnUsage = snapshot;
  return snapshot;
}

/**
 * The running turn's ledger, for a surface that renders it while the turn
 * streams. Reading it does not consume it: `endTurnUsage` remains the one
 * place the ledger is closed.
 */
export function peekTurnUsage(): TurnUsageSnapshot | null {
  return turnUsage;
}

/** The last turn's closed ledger, for a footer that keeps showing its cost. */
export function getLastTurnUsage(): TurnUsageSnapshot | null {
  return lastTurnUsage;
}

// The accounting below is one long branch of provider shapes; the rules
// themselves are the point, and splitting them would hide the order.
// eslint-disable-next-line complexity
export function recordRoundAccounting(options: {
  requestStartTime: number;
  responseEndTime: number;
  inputTokens: number;
  outputTokens: number;
  model: ModelConfig;
  tools?: ChatCompletionTool[];
  fullUsage: any;
  /** Compaction requests carry their own prefix and are not turn rounds. */
  isCompacting?: boolean;
  promptCacheKey?: string;
  cachePrefixVerdict?: CachePrefixVerdict;
  cachePrefixComparison?: { previous?: RequestHeader; current: RequestHeader };
}): {
  cost: number;
  cacheTokens: { cacheReadTokens?: number; cacheWriteTokens?: number };
} {
  const {
    requestStartTime,
    responseEndTime,
    inputTokens,
    outputTokens,
    model,
    tools,
    fullUsage,
    isCompacting,
    promptCacheKey,
    cachePrefixVerdict,
    cachePrefixComparison,
  } = options;

  const cost = recordStreamTelemetry({
    requestStartTime,
    responseEndTime,
    inputTokens,
    outputTokens,
    model,
    tools,
    fullUsage,
    requestKind: isCompacting ? "compaction" : "turn",
  });
  const cacheTokens = cacheTokensFrom(fullUsage);
  addRoundUsage(
    fullUsage?.prompt_tokens ?? inputTokens,
    fullUsage?.completion_tokens ?? outputTokens,
    cacheTokens.cacheReadTokens ?? 0,
    cacheTokens.cacheWriteTokens ?? 0,
    cost,
  );

  // Enhance fullUsage with model and cost for saving to session
  if (fullUsage) {
    fullUsage.model = model.model;
    fullUsage.cost_cents = Math.round(cost * 100); // Convert dollars to cents
  }

  const cacheRead = cacheTokens.cacheReadTokens ?? 0;
  const cacheWrite = cacheTokens.cacheWriteTokens ?? 0;
  const reportedInput = fullUsage?.prompt_tokens ?? inputTokens;
  if (reportedInput > 0) {
    const missOwner = attributeCacheMiss({
      verdict: cachePrefixVerdict,
      cacheReadTokens: cacheRead,
      inputTokens: reportedInput,
    });
    // Logged at info so the line is in the log file without a debug level
    // set: attribution that only exists in a log nobody turns on is not
    // attribution.
    logger.info("Request cache usage", {
      inputTokens: reportedInput,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cacheHitRatio: Number((cacheRead / reportedInput).toFixed(4)),
      prefixState:
        cachePrefixVerdict?.state ??
        (isCompacting ? COMPACTION_PREFIX_STATE : COLD_PREFIX_STATE),
      prefixReasons: cachePrefixVerdict?.reasons ?? [],
      ...(missOwner ? { cacheMissOwner: missOwner } : {}),
    });

    // A break is called out only when the bill shows it: more than the noise
    // floor of the previous round's prompt was billed again instead of read
    // from the cache. A provider that never reported cache activity is not
    // judged at all. Compaction rewrites the context, so the next prompt is new
    // content rather than re-billed content, and it resets the baseline.
    if (isCompacting) {
      forgetCacheRound(promptCacheKey);
      forgetCacheHitRates(promptCacheKey ?? "");
    } else {
      const round = {
        inputTokens: reportedInput,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
      };
      const breakAssessment = assessCacheBreak(
        recallCacheRound(promptCacheKey),
        round,
      );
      let reportPath: string | undefined;
      if (breakAssessment.report && cachePrefixComparison) {
        reportPath = writeCacheBreakReport({
          verdict: cachePrefixVerdict,
          previous:
            cachePrefixComparison.previous ?? cachePrefixComparison.current,
          current: cachePrefixComparison.current,
          assessment: breakAssessment,
        });
        logger.warn("Cache break", {
          hitRateBefore: Number(breakAssessment.previousRate.toFixed(4)),
          hitRateAfter: Number(breakAssessment.currentRate.toFixed(4)),
          dropPoints: Number(breakAssessment.dropPoints.toFixed(2)),
          missedTokens: breakAssessment.missedTokens,
          prefixState: cachePrefixVerdict?.state ?? COLD_PREFIX_STATE,
          prefixReasons: cachePrefixVerdict?.reasons ?? [],
          ...(missOwner ? { cacheMissOwner: missOwner } : {}),
          ...(reportPath ? { reportPath } : {}),
        });
      }

      // Held for the status bar: the session-wide ratio is an average and
      // cannot say why this round re-read everything. A request with no verdict
      // is the first of a conversation, so there is nothing to report yet - and
      // nothing stale to keep either, since the holder starts empty.
      if (cachePrefixVerdict) {
        rememberLastRequestCacheState({
          state: cachePrefixVerdict.state,
          reasons: cachePrefixVerdict.reasons,
          hitRate: Number((cacheRead / reportedInput).toFixed(4)),
          ...(reportPath ? { reportPath } : {}),
        });
      }
      recordCacheRound(promptCacheKey, round);

      // The floor only judges rounds where the provider told us about its
      // cache: a zero on a provider that never reports one describes the
      // provider, not this client's prefix.
      if (cacheRead > 0 || cacheWrite > 0) {
        lastRoundRate = cacheRead / reportedInput;
        noteCacheHitRate(promptCacheKey ?? "", cacheRead / reportedInput);
      }
    }
  }

  return { cost, cacheTokens };
}

/**
 * Processes tool calls by validating and preprocessing them
 * @param toolCalls - The raw tool calls from the LLM
 * @param callbacks - Optional callbacks for notifying of events
 * @returns - Preprocessed tool calls that are ready for execution
 */
