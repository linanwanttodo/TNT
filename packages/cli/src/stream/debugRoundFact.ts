import { calculateOutputTps } from "@zcode/shared";

import { recordDebugRound } from "../telemetry/debugRings.js";

import type { ContentSections } from "./contentSections.js";

/**
 * One round's fact for the browser's developer panel. The panel shows a tail
 * per conversation, so the record is written where the round's usage, its
 * cache numbers and its first-token time are all already in hand - the turn
 * ledger's caller hands them over in one object.
 */
export function recordDebugRoundFact(options: {
  promptCacheKey: string | undefined;
  inputTokens: number;
  outputTokens: number;
  fullUsage: any;
  cacheRead: number;
  cacheWrite: number;
  requestStartTime: number;
  responseEndTime: number;
  firstTokenTime: number | null | undefined;
  agentType: string | undefined;
  isCompacting: boolean | undefined;
  contentSections: ContentSections | undefined;
}): void {
  const reportedInput = options.fullUsage?.prompt_tokens ?? options.inputTokens;
  const reportedOutput =
    options.fullUsage?.completion_tokens ?? options.outputTokens;
  const reportedTotal =
    options.fullUsage?.total_tokens ?? reportedInput + reportedOutput;
  const reasoningTokens =
    options.fullUsage?.completion_tokens_details?.reasoning_tokens;
  const generationDurationMs =
    options.firstTokenTime === null || options.firstTokenTime === undefined
      ? null
      : Math.max(0, options.responseEndTime - options.firstTokenTime);
  const cacheReported = options.cacheRead > 0 || options.cacheWrite > 0;
  const hitRate =
    reportedInput > 0 && cacheReported
      ? options.cacheRead / reportedInput
      : null;

  recordDebugRound(options.promptCacheKey, {
    usage: {
      inputTokens: reportedInput,
      outputTokens: reportedOutput,
      totalTokens: reportedTotal,
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
      ...(options.cacheRead > 0
        ? { cachedInputTokens: options.cacheRead }
        : {}),
      ...(options.cacheWrite > 0
        ? { cachedWriteInputTokens: options.cacheWrite }
        : {}),
    },
    hitRate,
    generationDurationMs,
    tokensPerSecond: calculateOutputTps(reportedOutput, generationDurationMs),
    ...(options.agentType === undefined
      ? {}
      : { agentType: options.agentType }),
    ...(options.isCompacting === true ? { isCompacting: true } : {}),
    ...(options.contentSections === undefined
      ? {}
      : { sections: options.contentSections }),
  });
}
