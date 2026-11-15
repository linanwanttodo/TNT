import type { ChatHistoryItem } from "core/index.js";

import type { LoopDetector } from "../loop/loopDetector.js";
import { services } from "../services/index.js";
import { ToolCall } from "../tools/index.js";
import { logger } from "../utils/logger.js";

import {
  processChunkContent,
  processToolCallDelta,
  trackFirstTokenTime,
} from "./chunkProcessing.js";
import { StreamCallbacks } from "./streamChatResponse.types.js";

/**
 * Per-turn response state: what the UI is told, what the history looks like
 * after the service rewrote it, and how one streamed chunk is folded into the
 * response. None of it decides which request to send next; that stays in the
 * engine, which is why these live here rather than in the request loop.
 */

export function updateFinalResponse(
  content: string,
  shouldContinue: boolean,
  isHeadless: boolean,
  currentFinalResponse: string,
): string {
  if (!shouldContinue) {
    return content;
  } else if (isHeadless && content) {
    return content;
  }
  return currentFinalResponse;
}

export function handleContentDisplay(
  content: string,
  callbacks: StreamCallbacks | undefined,
  isHeadless: boolean,
): void {
  // Add newline after content if needed
  if (!callbacks?.onContent && !isHeadless && content) {
    logger.info("");
  }

  // Unconditional: a tool-only round has no content, and a live reasoning
  // overlay that is never told the round ended would carry into the next one.
  callbacks?.onReasoningComplete?.();

  // Notify content complete
  if (content && callbacks?.onContentComplete) {
    callbacks.onContentComplete(content);
  }
}

// Helper function to refresh chat history from service
export function refreshChatHistoryFromService(
  chatHistory: ChatHistoryItem[],
  isCompacting: boolean,
): ChatHistoryItem[] {
  const chatHistorySvc = services.chatHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    try {
      // use chat history from params when isCompacting is true
      // otherwise use the full history
      if (!isCompacting) {
        return chatHistorySvc.getHistory();
      }
    } catch {}
  }
  return chatHistory;
}

/**
 * Decide whether the turn continues after compaction, and how.
 *
 * A compaction that shrinks the history is progress and the turn should keep
 * going. A compaction that barely helped is not progress: appending another
 * continuation message to it would start the turn over with no headroom, so
 * the caller stops instead of looping.
 */
export function handleAutoContinuation(
  compactionOccurred: boolean,
  shouldContinue: boolean,
  chatHistory: ChatHistoryItem[],
  compactionWasWorthwhile: boolean,
): { shouldAutoContinue: boolean; chatHistory: ChatHistoryItem[] } {
  if (!compactionOccurred || shouldContinue || !compactionWasWorthwhile) {
    return { shouldAutoContinue: false, chatHistory };
  }

  logger.debug(
    "Auto-compaction occurred during this turn - automatically continuing session",
  );

  // Add a continuation message to the history
  const chatHistorySvc = services.chatHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    chatHistorySvc.addUserMessage("continue");
    chatHistory = chatHistorySvc.getHistory();
  } else {
    chatHistory.push({
      message: {
        role: "user",
        content: "continue",
      },
      contextItems: [],
    });
  }

  logger.debug("Added continuation message after compaction");
  return { shouldAutoContinue: true, chatHistory };
}

// Helper function to process a single chunk
export interface ProcessChunkOptions {
  chunk: any;
  aiResponse: string;
  toolCallsMap: Map<string, ToolCall>;
  indexToIdMap: Map<number, string>;
  callbacks?: StreamCallbacks;
  isHeadless?: boolean;
  loopDetector?: LoopDetector;
}

export function processChunk(options: ProcessChunkOptions): {
  aiResponse: string;
  shouldContinue: boolean;
  /** The reasoning delta in this chunk, when the provider separates it. */
  reasoningDelta?: string;
} {
  const {
    chunk,
    aiResponse,
    toolCallsMap,
    indexToIdMap,
    callbacks,
    isHeadless,
    loopDetector,
  } = options;
  // Safety check: ensure chunk has the expected structure
  if (!chunk.choices || !chunk.choices[0]) {
    return { aiResponse, shouldContinue: true };
  }

  const choice = chunk.choices[0];
  if (!choice.delta) {
    return { aiResponse, shouldContinue: true };
  }

  let updatedResponse = aiResponse;

  // Reasoning is a separate channel when the provider sends one. It is not
  // appended to the answer, so the fallback <think> parser only sees providers
  // that embed it in content.
  const reasoningDelta =
    typeof choice.delta.reasoning_content === "string"
      ? choice.delta.reasoning_content
      : typeof choice.delta.reasoning === "string"
        ? choice.delta.reasoning
        : undefined;
  if (reasoningDelta) {
    callbacks?.onReasoning?.(reasoningDelta);
  }

  // Handle content streaming
  if (choice.delta.content) {
    updatedResponse = processChunkContent(
      choice.delta.content,
      aiResponse,
      callbacks,
      isHeadless,
      loopDetector,
    );
  }

  // Handle tool calls
  if (choice.delta.tool_calls) {
    for (const toolCallDelta of choice.delta.tool_calls) {
      processToolCallDelta(toolCallDelta, toolCallsMap, indexToIdMap);
    }
  }

  return { aiResponse: updatedResponse, shouldContinue: true, reasoningDelta };
}

/**
 * The mutable state one streaming round folds its chunks into. The round owns
 * the object, so a stream that throws mid-way still leaves the partial answer
 * and usage readable by the caller's error paths.
 */
export interface StreamAccumulator {
  aiResponse: string;
  reasoningText: string;
  toolCallsMap: Map<string, ToolCall>;
  indexToIdMap: Map<number, string>;
  inputTokens: number;
  outputTokens: number;
  fullUsage: any;
}

/**
 * Consumes one provider stream: folds each chunk into the accumulator, tracks
 * the usage payload, and stops on abort or when the chunk processor says the
 * stream is over. Returns the number of chunks seen.
 */
export async function consumeProviderStream(
  stream: AsyncIterable<any>,
  state: StreamAccumulator,
  options: {
    abortSignal?: AbortSignal;
    callbacks?: StreamCallbacks;
    isHeadless?: boolean;
    model: any;
    tools?: any[];
    requestStartTime: number;
    loopDetector?: LoopDetector;
  },
): Promise<number> {
  let chunkCount = 0;
  let firstTokenTime: number | null = null;

  for await (const chunk of stream) {
    chunkCount++;

    logger.debug("Received chunk", { chunkCount, chunk });

    // Track token usage if available
    if (chunk.usage) {
      state.inputTokens = chunk.usage.prompt_tokens || 0;
      state.outputTokens = chunk.usage.completion_tokens || 0;
      state.fullUsage = chunk.usage; // Capture full usage including cache details
    }

    // Check if we should abort
    if (options.abortSignal?.aborted) {
      logger.debug("Stream aborted");
      break;
    }

    // Track first token time
    firstTokenTime = trackFirstTokenTime(
      firstTokenTime,
      chunk,
      options.requestStartTime,
      options.model,
      options.tools,
    );

    const result = processChunk({
      chunk,
      aiResponse: state.aiResponse,
      toolCallsMap: state.toolCallsMap,
      indexToIdMap: state.indexToIdMap,
      callbacks: options.callbacks,
      isHeadless: options.isHeadless,
      loopDetector: options.loopDetector,
    });
    state.aiResponse = result.aiResponse;
    if (result.reasoningDelta) {
      state.reasoningText += result.reasoningDelta;
    }
    if (!result.shouldContinue) break;
  }

  return chunkCount;
}
