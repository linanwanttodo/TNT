import { ModelConfig } from "@continuedev/config-yaml";
import { BaseLlmApi } from "@continuedev/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistoryWithSystemMessage } from "core/util/messageConversion.js";
import * as dotenv from "dotenv";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources.mjs";

import { pruneLastMessage } from "../compaction.js";
import { LoopDetector, type LoopDetection } from "../loop/loopDetector.js";
import { ToolFailureTracker } from "../loop/toolFailureTracker.js";
import {
  describeTermination,
  type TerminationReason,
} from "../loop/termination.js";
import {
  classifyStreamError,
  type TerminalStopKind,
  TerminalStopTracker,
} from "../loop/terminalStop.js";
import { TurnBudget, type TurnBudgetLimits } from "../loop/turnBudget.js";
import { services } from "../services/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { applyChatCompletionToolOverrides } from "../tools/applyToolOverrides.js";
import { ToolCall } from "../tools/index.js";
import {
  chatCompletionStreamWithBackoff,
  isContextLengthError,
  withExponentialBackoff,
} from "../util/exponentialBackoff.js";
import { logger } from "../util/logger.js";
import { validateContextLength } from "../util/tokenizer.js";

import { getRequestTools, handleToolCalls } from "./handleToolCalls.js";
import {
  handleNormalAutoCompaction,
  handlePostToolValidation,
  handlePreApiCompaction,
} from "./streamChatResponse.compactionHelpers.js";
import {
  processChunkContent,
  processToolCallDelta,
  recordStreamTelemetry,
  trackFirstTokenTime,
} from "./streamChatResponse.helpers.js";
import {
  getDefaultCompletionOptions,
  StreamCallbacks,
} from "./streamChatResponse.types.js";

dotenv.config();

function updateFinalResponse(
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

function handleContentDisplay(
  content: string,
  callbacks: StreamCallbacks | undefined,
  isHeadless: boolean,
): void {
  // Add newline after content if needed
  if (!callbacks?.onContent && !isHeadless && content) {
    logger.info("");
  }

  // Notify content complete
  if (content && callbacks?.onContentComplete) {
    callbacks.onContentComplete(content);
  }
}

// Helper function to refresh chat history from service
function refreshChatHistoryFromService(
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
function handleAutoContinuation(
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
interface ProcessChunkOptions {
  chunk: any;
  aiResponse: string;
  toolCallsMap: Map<string, ToolCall>;
  indexToIdMap: Map<number, string>;
  callbacks?: StreamCallbacks;
  isHeadless?: boolean;
  loopDetector?: LoopDetector;
}

function processChunk(options: ProcessChunkOptions): {
  aiResponse: string;
  shouldContinue: boolean;
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

  return { aiResponse: updatedResponse, shouldContinue: true };
}

interface ProcessStreamingResponseOptions {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  llmApi: BaseLlmApi;
  abortController: AbortController;
  callbacks?: StreamCallbacks;
  isHeadless?: boolean;
  tools?: ChatCompletionTool[];
  systemMessage: string;
}

// Process a single streaming response and return whether we need to continue
// eslint-disable-next-line max-statements, complexity
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
   * Set when the round ended because the stream was cut short. The caller
   * decides whether to retry based on its own per-turn budget.
   */
  terminalStop?: TerminalStopKind;
}> {
  const {
    model,
    llmApi,
    abortController,
    callbacks,
    isHeadless,
    tools,
    systemMessage,
  } = options;

  let chatHistory = options.chatHistory;

  // Safety buffer to account for tokenization estimation errors
  const SAFETY_BUFFER = 100;

  // Validate context length INCLUDING system message and tools
  let validation = validateContextLength({
    chatHistory,
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
      chatHistory,
      model,
      safetyBuffer: SAFETY_BUFFER,
      systemMessage,
      tools,
    });
  }

  if (!validation.isValid) {
    throw new Error(`Context length validation failed: ${validation.error}`);
  }

  // Create OpenAI format history with validated system message
  const openaiChatHistory = convertFromUnifiedHistoryWithSystemMessage(
    chatHistory,
    systemMessage,
  ) as ChatCompletionMessageParam[];
  const requestStartTime = Date.now();

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
      },
      retryAbortSignal,
    );
  };

  let aiResponse = "";
  let finalContent = "";
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
    });
    const totalDuration = responseEndTime - requestStartTime;

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
      cacheReadTokens: fullUsage?.prompt_tokens_details?.cache_read_tokens,
      cacheWriteTokens: fullUsage?.prompt_tokens_details?.cache_write_tokens,
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
        content: aiResponse,
        finalContent: aiResponse,
        toolCalls: [],
        shouldContinue: false,
        usage: fullUsage,
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
        terminalStop: stopKind,
      };
    }

    // Handle context length errors with helpful message
    if (isContextLengthError(error)) {
      logger.debug(`Context length exceeded: ${error}`);
      throw new Error(`Context length exceeded: ${error}`);
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
  };
}

// Main function that handles the conversation loop
// eslint-disable-next-line max-params
export async function streamChatResponse(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  abortController: AbortController,
  callbacks?: StreamCallbacks,
  isCompacting = false,
  turnBudgetLimits?: Partial<TurnBudgetLimits>,
) {
  logger.debug("streamChatResponse called", {
    model,
    historyLength: chatHistory.length,
    hasCallbacks: !!callbacks,
  });

  const isHeadless = services.toolPermissions.isHeadless();

  let fullResponse = "";
  let finalResponse = "";
  let compactionOccurredThisTurn = false; // Track if compaction happened during this conversation turn

  // One budget, one failure tally, and one repetition detector per user turn.
  // They reset together because all three measure the same span: this turn.
  const budget = new TurnBudget(turnBudgetLimits);
  const toolFailures = new ToolFailureTracker();
  const terminalStops = new TerminalStopTracker();

  /**
   * End the turn, tell the caller why, and return the text produced so far.
   * Every exit from the loop goes through here so no path can end silently.
   */
  const finish = (reason: TerminationReason): string => {
    callbacks?.onTurnTerminated?.(reason, {
      maxSteps: budget.limits.maxSteps,
      notice: describeTermination(reason, {
        maxSteps: budget.limits.maxSteps,
      }),
    });
    logger.debug("streamChatResponse terminated", {
      reason,
      steps: budget.stepsDone,
      totalResponseLength: fullResponse.length,
      totalMessages: chatHistory.length,
    });
    return isHeadless ? finalResponse : fullResponse;
  };

  while (true) {
    // The abort signal used to be ignored here, so a cancelled turn kept
    // requesting models until one of them happened to return no tool calls.
    if (abortController?.signal.aborted) {
      return finish("user_abort");
    }

    // Checked before the round rather than after, so a turn that is already
    // over budget stops instead of spending one more round to find that out.
    if (budget.stepsExhausted) {
      return finish("max_steps");
    }

    // If ChatHistoryService is available, refresh local chatHistory view
    chatHistory = refreshChatHistoryFromService(chatHistory, isCompacting);
    // Reduction ratios reported by this round's three compaction checkpoints,
    // in the order they can fire. Reset each round so a stale ratio from an
    // earlier round cannot be read as this round's result.
    let preApiReductionRatio: number | undefined;
    let postToolReductionRatio: number | undefined;
    // Snapshot before this round's tool calls so the tail can measure how much
    // the conversation actually grew.
    const historyLengthBefore = chatHistory.length;
    logger.debug("Starting conversation iteration");

    // Get system message once per iteration (can change based on tool permissions mode)
    const systemMessage = await services.systemMessage.getSystemMessage(
      services.toolPermissions.getState().currentMode,
    );

    // Recompute tools on each iteration to handle mode changes during streaming
    const rawTools = await getRequestTools(isHeadless);
    const tools = applyChatCompletionToolOverrides(
      rawTools,
      model.chatOptions?.toolOverrides,
    );

    // Pre-API auto-compaction checkpoint (now includes tools)
    const preCompactionResult = await handlePreApiCompaction(chatHistory, {
      model,
      llmApi,
      isCompacting,
      isHeadless,
      callbacks,
      systemMessage,
      tools,
    });
    chatHistory = preCompactionResult.chatHistory;
    if (preCompactionResult.wasCompacted) {
      compactionOccurredThisTurn = true;
    }
    preApiReductionRatio = preCompactionResult.reductionRatio;

    logger.debug("Tools prepared", {
      toolCount: tools.length,
      toolNames: tools.map((t) => t.function.name),
    });

    // Get response from LLM
    const {
      content,
      toolCalls,
      shouldContinue,
      usage,
      loopDetection,
      terminalStop,
    } = await processStreamingResponse({
      isHeadless,
      chatHistory,
      model,
      llmApi,
      abortController,
      callbacks,
      tools,
      systemMessage,
    });

    if (abortController?.signal.aborted) {
      return finish("user_abort");
    }

    // Retry only while this kind of fault still has budget. Once the budget is
    // gone the turn ends, because retrying an unchanging fault only spends
    // tokens to arrive at the same place.
    if (terminalStop) {
      if (terminalStops.shouldRetry(terminalStop)) {
        logger.debug("Retrying round after early stream end", {
          kind: terminalStop,
          attempt: terminalStops.retriesUsed(terminalStop),
        });
        continue;
      }
      return finish("stream_stall");
    }

    // Repetition is checked after the abort test so an interrupted stream is
    // never reported as a model loop.
    if (loopDetection) {
      logger.warn("Repetitive output detected", {
        kind: loopDetection.kind,
        repetitions: loopDetection.repetitions,
        fingerprint: loopDetection.fingerprint,
      });
      return finish("loop_detected");
    }

    fullResponse += content;

    // Update final response based on mode
    finalResponse = updateFinalResponse(
      content,
      shouldContinue,
      isHeadless,
      finalResponse,
    );

    // Handle content display
    handleContentDisplay(content, callbacks, isHeadless);

    // Handle tool calls and check for early return. This updates history via ChatHistoryService.
    const shouldReturn = await handleToolCalls({
      toolCalls,
      chatHistory,
      content,
      callbacks,
      isHeadless,
      usage,
      onToolOutcome: (toolName, succeeded, error) => {
        const notice = toolFailures.record(toolName, succeeded, error);
        if (notice) {
          // Appended as a tool result rather than a user message so the model
          // sees it in the place it is working, without a new turn boundary.
          logger.warn("Tool repeatedly failing", {
            tool: notice.toolName,
            consecutiveFailures: notice.consecutiveFailures,
            lastError: notice.lastError,
          });
        }
      },
    });

    if (shouldReturn) {
      return finish("tool_stop");
    }

    // After tool execution, validate that we haven't exceeded context limit
    const postToolResult = await handlePostToolValidation(
      toolCalls,
      chatHistory,
      {
        model,
        llmApi,
        isCompacting,
        isHeadless,
        callbacks,
        systemMessage,
        tools,
      },
    );
    chatHistory = postToolResult.chatHistory;
    if (postToolResult.wasCompacted) {
      compactionOccurredThisTurn = true;
    }
    postToolReductionRatio = postToolResult.reductionRatio;

    // Normal auto-compaction check at 80% threshold
    const compactionResult = await handleNormalAutoCompaction(
      chatHistory,
      shouldContinue,
      {
        model,
        llmApi,
        isCompacting,
        isHeadless,
        callbacks,
        systemMessage,
        tools,
      },
    );
    chatHistory = compactionResult.chatHistory;
    if (compactionResult.wasCompacted) {
      compactionOccurredThisTurn = true;
    }

    // A compaction is only progress if it actually removed something. The
    // model call it spent is real either way, so one that barely shrank the
    // history leaves the next round just as expensive as this one.
    // Reported by the helpers themselves, because only they know what their
    // compaction actually removed.
    const reductionRatio =
      compactionResult.reductionRatio ??
      postToolReductionRatio ??
      preApiReductionRatio;
    // Only a round that actually compacted counts toward the compaction
    // circuit. A round with no compaction at all is not a failed compaction.
    const compactionWasWorthwhile = compactionOccurredThisTurn
      ? budget.recordCompaction(reductionRatio)
      : true;

    // Once compaction has failed this many times the context is not going to
    // recover on its own, and each retry spends another summarization call.
    if (compactionOccurredThisTurn && budget.compactionCircuitOpen) {
      return finish("compaction_circuit_open");
    }

    // Charge the round to the budget. Progress is measured as the growth of
    // the conversation rather than the length of one reply: a round that adds
    // one short line on top of a long history has not moved the task forward,
    // while a round that appends a tool result has. The provider's own output
    // count is used when present because it is exact.
    const historyGrowth = Math.max(0, chatHistory.length - historyLengthBefore);
    const tokensAdded =
      usage?.completion_tokens ??
      usage?.outputTokens ??
      Math.ceil(historyGrowth * 200);
    const budgetState = budget.recordStep(tokensAdded);
    if (budgetState === "steps_exhausted") {
      return finish("max_steps");
    }
    if (budgetState === "diminishing_returns") {
      return finish("diminishing_returns");
    }

    // If compaction happened during this turn and we're about to stop,
    // automatically send a continuation message to keep the agent going
    const autoContinueResult = handleAutoContinuation(
      compactionOccurredThisTurn,
      shouldContinue,
      chatHistory,
      compactionWasWorthwhile,
    );
    chatHistory = autoContinueResult.chatHistory;
    const shouldAutoContinue = autoContinueResult.shouldAutoContinue;

    // Reset flag to avoid infinite continuation
    if (shouldAutoContinue) {
      compactionOccurredThisTurn = false;
    }

    // Check if we should continue (skip the end if auto-continuing after
    // compaction). Goes through finish so the caller still learns the turn
    // ended, rather than the loop breaking quietly.
    if (!shouldContinue && !shouldAutoContinue) {
      return finish("no_tool_calls");
    }
  }

  logger.debug("streamChatResponse complete", {
    totalResponseLength: fullResponse.length,
    totalMessages: chatHistory.length,
  });

  // For headless mode, we return only the final response
  // Otherwise, return the full response
  return finish("no_tool_calls");
}
