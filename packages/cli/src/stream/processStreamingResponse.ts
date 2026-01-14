import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistoryWithSystemMessage } from "core/util/messageConversion.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources.mjs";

import {
  assessCacheBreak,
  recallCacheRound,
  recordCacheRound,
  writeCacheBreakReport,
} from "../cache/cacheBreakReport.js";
import { rememberLastRequestCacheState } from "../cache/lastRequestCacheState.js";
import {
  attributeCacheMiss,
  COMPACTION_PREFIX_STATE,
  COLD_PREFIX_STATE,
  type CachePrefixVerdict,
} from "../cache/prefixState.js";
import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import type { RequestHeader } from "../cache/requestHeader.js";
import { pruneLastMessage } from "../compaction/index.js";
import { t } from "../i18n/index.js";
import { LoopDetector, type LoopDetection } from "../loop/loopDetector.js";
import {
  classifyStreamError,
  type TerminalStopKind,
} from "../loop/terminalStop.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { ToolCall } from "../tools/index.js";
import {
  chatCompletionStreamWithBackoff,
  withExponentialBackoff,
} from "../utils/exponentialBackoff.js";
import { logger } from "../utils/logger.js";
import { validateContextLength } from "../utils/tokenizer.js";

import { processChunk } from "./responseChunks.js";
import {
  cacheTokensFrom,
  recordStreamTelemetry,
  trackFirstTokenTime,
} from "./streamChatResponse.helpers.js";
import {
  getDefaultCompletionOptions,
  StreamCallbacks,
} from "./streamChatResponse.types.js";

interface ProcessStreamingResponseOptions {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  llmApi: BaseLlmApi;
  abortController: AbortController;
  callbacks?: StreamCallbacks;
  isHeadless?: boolean;
  tools?: ChatCompletionTool[];
  systemMessage: string;
  systemMessageUpdates?: readonly string[];
  /** True when this request is a compaction, whose prefix is not the session's. */
  isCompacting?: boolean;
  /**
   * How this request's prefix relates to the last one the provider saw. Only
   * the caller building the request can tell, so it is passed in rather than
   * recomputed here.
   */
  cachePrefixVerdict?: CachePrefixVerdict;
  /**
   * The prefix this request was compared against and the one it actually sent,
   * so a reported break can show the bytes that moved rather than only the name
   * of the field that changed.
   */
  cachePrefixComparison?: { previous?: RequestHeader; current: RequestHeader };
}

// Process a single streaming response and return whether we need to continue
export async function processStreamingResponse(
  options: ProcessStreamingResponseOptions,
): Promise<{
  content: string;
  finalContent: string; // Added field for final content only
  toolCalls: ToolCall[];
  shouldContinue: boolean;
  usage?: any;
  loopDetection?: LoopDetection;
  /**
   * The reasoning channel's text for this round. Providers that separate it
   * from the answer send it as deltas; it is kept so the transcript can render
   * the thought instead of dropping it.
   */
  reasoning?: string;
  /**
   * Set when the round ended because the stream was cut short. The caller
   * decides whether to retry based on its own per-turn budget.
   */
  terminalStop?: TerminalStopKind;
  /**
   * The provider's own words, kept so a refusal the loop cannot recover from is
   * reported as what the vendor said rather than as a generic failure.
   */
  terminalStopMessage?: string;
}> {
  const {
    model,
    llmApi,
    abortController,
    callbacks,
    isHeadless,
    tools,
    systemMessage,
    systemMessageUpdates = [],
    isCompacting,
    cachePrefixVerdict,
    cachePrefixComparison,
  } = options;

  let chatHistory = options.chatHistory;

  // Safety buffer to account for tokenization estimation errors
  const SAFETY_BUFFER = 100;

  // Validate context length INCLUDING system message and tools
  const systemMessageHistory = systemMessageUpdates.map((content) => ({
    message: { role: "system" as const, content },
    contextItems: [],
  }));
  let validation = validateContextLength({
    chatHistory: [...chatHistory, ...systemMessageHistory],
    model,
    safetyBuffer: SAFETY_BUFFER,
    systemMessage,
    tools,
  });

  // Prune last messages until valid (excluding system message)
  while (chatHistory.length > 1 && !validation.isValid) {
    const prunedChatHistory = pruneLastMessage(chatHistory);
    if (prunedChatHistory.length === chatHistory.length) {
      break;
    }
    chatHistory = prunedChatHistory;

    // Re-validate with system message and tools
    validation = validateContextLength({
      chatHistory: [...chatHistory, ...systemMessageHistory],
      model,
      safetyBuffer: SAFETY_BUFFER,
      systemMessage,
      tools,
    });
  }

  if (!validation.isValid) {
    throw new Error(
      t("stream.contextValidationFailed", { error: String(validation.error) }),
    );
  }

  // Create OpenAI format history with validated system message
  const openaiChatHistory = [
    ...convertFromUnifiedHistoryWithSystemMessage(chatHistory, systemMessage),
    ...systemMessageUpdates.map((content): ChatCompletionMessageParam => ({
      role: "system",
      content,
    })),
  ] as ChatCompletionMessageParam[];
  const requestStartTime = Date.now();
  const promptCacheKey = currentPromptCacheKey();

  const streamFactory = async (retryAbortSignal: AbortSignal) => {
    logger.debug("Creating chat completion stream", {
      model,
      messageCount: chatHistory.length,
      toolCount: tools?.length || 0,
    });
    return await chatCompletionStreamWithBackoff(
      llmApi,
      {
        model: model.model,
        messages: openaiChatHistory,
        stream: true,
        tools,
        ...getDefaultCompletionOptions(model.defaultCompletionOptions),
        max_tokens: validation.maxTokens,
        ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
      },
      retryAbortSignal,
    );
  };

  let aiResponse = "";
  let finalContent = "";
  let reasoningText = "";
  const toolCallsMap = new Map<string, ToolCall>();
  const indexToIdMap = new Map<number, string>(); // Track index to ID mapping
  let firstTokenTime: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let fullUsage: any = null;
  // One detector per assistant message. A repetition spanning two separate
  // messages is a different problem and is not what this catches.
  const loopDetector = new LoopDetector();

  try {
    const streamWithBackoff = withExponentialBackoff(
      streamFactory,
      abortController.signal,
    );

    let chunkCount = 0;
    for await (const chunk of streamWithBackoff) {
      chunkCount++;

      logger.debug("Received chunk", { chunkCount, chunk });

      // Track token usage if available
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || 0;
        fullUsage = chunk.usage; // Capture full usage including cache details
      }

      // Check if we should abort
      if (abortController?.signal.aborted) {
        logger.debug("Stream aborted");
        break;
      }

      // Track first token time
      firstTokenTime = trackFirstTokenTime(
        firstTokenTime,
        chunk,
        requestStartTime,
        model,
        tools,
      );

      const result = processChunk({
        chunk,
        aiResponse,
        toolCallsMap,
        indexToIdMap,
        callbacks,
        isHeadless,
        loopDetector,
      });
      aiResponse = result.aiResponse;
      if (result.reasoningDelta) {
        reasoningText += result.reasoningDelta;
      }
      if (!result.shouldContinue) break;
    }

    const responseEndTime = Date.now();
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
    const totalDuration = responseEndTime - requestStartTime;
    const cacheTokens = cacheTokensFrom(fullUsage);

    // Enhance fullUsage with model and cost for saving to session
    if (fullUsage) {
      fullUsage.model = model.model;
      fullUsage.cost_cents = Math.round(cost * 100); // Convert dollars to cents
    }

    logger.debug("Stream complete", {
      chunkCount,
      responseLength: aiResponse.length,
      toolCallsCount: toolCallsMap.size,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheTokens.cacheReadTokens,
      cacheWriteTokens: cacheTokens.cacheWriteTokens,
      cost,
      duration: totalDuration,
    });

    // The hit ratio is logged for every request rather than only the session
    // total, because the session total is an average over requests that may
    // have used entirely different prefixes. A zero here on an otherwise
    // identical second request is the signal that something in the prefix moved.
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

      // A break is called out only when the bill shows it: a drop of a few points,
      // or one on a request too short for the provider to have cached anything, is
      // noise and would train nobody to ignore the line. The diff goes to a file
      // because "the tool list moved" is not something a reader can act on.
      const round = { inputTokens: reportedInput, cacheReadTokens: cacheRead };
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
          prefixState: cachePrefixVerdict?.state ?? COLD_PREFIX_STATE,
          prefixReasons: cachePrefixVerdict?.reasons ?? [],
          ...(missOwner ? { cacheMissOwner: missOwner } : {}),
          ...(reportPath ? { reportPath } : {}),
        });
      }

      // Held for the status bar: the session-wide ratio is an average and cannot
      // say why this round re-read everything. A request with no verdict is the
      // first of a conversation, so there is nothing to report yet - and nothing
      // stale to keep either, since the holder starts empty.
      if (cachePrefixVerdict) {
        rememberLastRequestCacheState({
          state: cachePrefixVerdict.state,
          reasons: cachePrefixVerdict.reasons,
          hitRate: Number((cacheRead / reportedInput).toFixed(4)),
          ...(reportPath ? { reportPath } : {}),
        });
      }
      recordCacheRound(promptCacheKey, round);
    }
  } catch (error: any) {
    const errorDuration = Date.now() - requestStartTime;

    // Log failed API request
    telemetryService.logApiRequest({
      model: model.model,
      durationMs: errorDuration,
      success: false,
      error: error.message || String(error),
    });

    if (error.name === "AbortError" || abortController?.signal.aborted) {
      logger.debug("Stream aborted by user");
      return {
        content: aiResponse,
        finalContent: aiResponse,
        toolCalls: [],
        shouldContinue: false,
        usage: fullUsage,
        reasoning: reasoningText,
      };
    }

    // A stream that was cut before its terminal event is not the same as a
    // completed turn. Reported to the caller instead of thrown so the loop can
    // decide whether this kind of fault is still worth retrying.
    const stopKind = classifyStreamError(error);
    if (stopKind !== "ok") {
      logger.warn("Stream ended early", {
        kind: stopKind,
        error: error.message || String(error),
      });
      return {
        content: aiResponse,
        finalContent: aiResponse,
        toolCalls: [],
        shouldContinue: false,
        usage: fullUsage,
        reasoning: reasoningText,
        terminalStop: stopKind,
        terminalStopMessage: error.message || String(error),
      };
    }

    throw error;
  }

  const toolCalls = Array.from(toolCallsMap.values());

  // Validate tool calls have complete arguments
  const validToolCalls = toolCalls.filter((tc) => {
    if (!tc.name) {
      logger.error("Incomplete tool call", {
        id: tc.id,
        name: tc.name,
        hasArguments: !!tc.arguments,
        argumentsStr: tc.argumentsStr,
      });
      return false;
    }
    return true;
  });

  // Always preserve the content - it should be displayed regardless of tool calls
  finalContent = aiResponse;

  return {
    content: aiResponse,
    finalContent: finalContent,
    toolCalls: validToolCalls,
    shouldContinue: validToolCalls.length > 0,
    usage: fullUsage,
    loopDetection: loopDetector.finish(),
    reasoning: reasoningText,
  };
}

// Main function that handles the conversation loop
