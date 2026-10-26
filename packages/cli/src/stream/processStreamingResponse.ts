import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistoryWithSystemMessage } from "core/util/messageConversion.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources.mjs";

import type { CachePrefixVerdict } from "../cache/prefixState.js";
import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import type { RequestHeader } from "../cache/requestHeader.js";
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

import { pruneHistoryToContextLimit } from "./requestPreparation.js";
import {
  consumeProviderStream,
  type StreamAccumulator,
} from "./responseChunks.js";
import { recordRoundAccounting } from "./streamChatResponse.helpers.js";
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

  // Prune trailing messages until the request fits the window, counting the
  // system message, its updates and the tool list. Still too large throws here.
  const { chatHistory: prunedChatHistory, maxTokens } =
    pruneHistoryToContextLimit({
      chatHistory,
      model,
      systemMessage,
      systemMessageUpdates,
      tools,
    });
  chatHistory = prunedChatHistory;

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
        max_tokens: maxTokens,
        ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
      },
      retryAbortSignal,
    );
  };

  // One detector per assistant message. A repetition spanning two separate
  // messages is a different problem and is not what this catches.
  const loopDetector = new LoopDetector();
  // The accumulator is mutated by the stream consumer, so a stream that
  // throws mid-way still leaves the partial answer readable to the catch.
  const streamState: StreamAccumulator = {
    aiResponse: "",
    reasoningText: "",
    toolCallsMap: new Map<string, ToolCall>(),
    indexToIdMap: new Map<number, string>(),
    inputTokens: 0,
    outputTokens: 0,
    fullUsage: null,
  };

  try {
    const streamWithBackoff = withExponentialBackoff(
      streamFactory,
      abortController.signal,
    );

    const chunkCount = await consumeProviderStream(
      streamWithBackoff,
      streamState,
      {
        abortSignal: abortController.signal,
        callbacks,
        isHeadless,
        model,
        tools,
        requestStartTime,
        loopDetector,
      },
    );

    const responseEndTime = Date.now();
    const { cost, cacheTokens } = recordRoundAccounting({
      requestStartTime,
      responseEndTime,
      inputTokens: streamState.inputTokens,
      outputTokens: streamState.outputTokens,
      model,
      tools,
      fullUsage: streamState.fullUsage,
      isCompacting,
      promptCacheKey,
      cachePrefixVerdict,
      cachePrefixComparison,
    });
    const totalDuration = responseEndTime - requestStartTime;

    logger.debug("Stream complete", {
      chunkCount,
      responseLength: streamState.aiResponse.length,
      toolCallsCount: streamState.toolCallsMap.size,
      inputTokens: streamState.inputTokens,
      outputTokens: streamState.outputTokens,
      cacheReadTokens: cacheTokens.cacheReadTokens,
      cacheWriteTokens: cacheTokens.cacheWriteTokens,
      cost,
      duration: totalDuration,
    });
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
        content: streamState.aiResponse,
        finalContent: streamState.aiResponse,
        toolCalls: [],
        shouldContinue: false,
        usage: streamState.fullUsage,
        reasoning: streamState.reasoningText,
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
        content: streamState.aiResponse,
        finalContent: streamState.aiResponse,
        toolCalls: [],
        shouldContinue: false,
        usage: streamState.fullUsage,
        reasoning: streamState.reasoningText,
        terminalStop: stopKind,
        terminalStopMessage: error.message || String(error),
      };
    }

    throw error;
  }

  const toolCalls = Array.from(streamState.toolCallsMap.values());

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
  const finalContent = streamState.aiResponse;

  return {
    content: streamState.aiResponse,
    finalContent: finalContent,
    toolCalls: validToolCalls,
    shouldContinue: validToolCalls.length > 0,
    usage: streamState.fullUsage,
    loopDetection: loopDetector.finish(),
    reasoning: streamState.reasoningText,
  };
}

// Main function that handles the conversation loop
