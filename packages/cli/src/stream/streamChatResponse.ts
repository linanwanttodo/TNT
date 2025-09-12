import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistoryWithSystemMessage } from "core/util/messageConversion.js";
import * as dotenv from "dotenv";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources.mjs";

import {
  attributeCacheMiss,
  cachePrefixKeys,
  classifyCachePrefix,
  COMPACTION_PREFIX_STATE,
  COLD_PREFIX_STATE,
  type CachePrefixVerdict,
  recallCachePrefix,
  rememberCachePrefix,
} from "../cache/prefixState.js";
import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import {
  assessCacheBreak,
  recallCacheRound,
  recordCacheRound,
  writeCacheBreakReport,
} from "../cache/cacheBreakReport.js";
import { type RequestHeader } from "../cache/requestHeader.js";
import { pruneLastMessage } from "../compaction/index.js";
import { LoopDetector, type LoopDetection } from "../loop/loopDetector.js";
import {
  classifyStreamError,
  OVERFLOW_RECOVERIES,
  type TerminalStopKind,
  TerminalStopTracker,
} from "../loop/terminalStop.js";
import {
  describeTermination,
  type TerminationReason,
} from "../loop/termination.js";
import { ToolFailureTracker } from "../loop/toolFailureTracker.js";
import { TurnBudget, type TurnBudgetLimits } from "../loop/turnBudget.js";
import { services } from "../services/index.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { applyChatCompletionToolOverrides } from "../tools/applyToolOverrides.js";
import { ToolCall } from "../tools/index.js";
import {
  chatCompletionStreamWithBackoff,
  withExponentialBackoff,
} from "../utils/exponentialBackoff.js";
import { logger } from "../utils/logger.js";
import { validateContextLength } from "../utils/tokenizer.js";

import { getRequestTools, handleToolCalls } from "./handleToolCalls.js";
import {
  handleNormalAutoCompaction,
  handlePostToolValidation,
  handlePreApiCompaction,
} from "./streamChatResponse.compactionHelpers.js";
import {
  cacheTokensFrom,
  processChunkContent,
  processToolCallDelta,
  recordStreamTelemetry,
  trackFirstTokenTime,
} from "./streamChatResponse.helpers.js";
import {
  getDefaultCompletionOptions,
  StreamCallbacks,
  StreamRunOverrides,
} from "./streamChatResponse.types.js";
import { decideSystemPrompt } from "./systemPromptPolicy.js";

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
    throw new Error(`Context length validation failed: ${validation.error}`);
  }

  // Create OpenAI format history with validated system message
  const openaiChatHistory = [
    ...convertFromUnifiedHistoryWithSystemMessage(chatHistory, systemMessage),
    ...systemMessageUpdates.map(
      (content): ChatCompletionMessageParam => ({
        role: "system",
        content,
      }),
    ),
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
      if (breakAssessment.report && cachePrefixComparison) {
        const reportPath = writeCacheBreakReport({
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
  /**
   * Overrides for a delegated run. Left unset, every value falls back to the
   * process-wide services, so a top-level turn is unaffected.
   */
  runOverrides?: StreamRunOverrides,
) {
  logger.debug("streamChatResponse called", {
    model,
    historyLength: chatHistory.length,
    hasCallbacks: !!callbacks,
  });

  const isHeadless =
    runOverrides?.isHeadless ?? services.toolPermissions.isHeadless();

  let fullResponse = "";
  let finalResponse = "";
  let compactionOccurredThisTurn = false; // Track if compaction happened during this conversation turn

  // One budget, one failure tally, and one repetition detector per user turn.
  // They reset together because all three measure the same span: this turn.
  const budget = new TurnBudget(turnBudgetLimits);
  const toolFailures = new ToolFailureTracker();
  const terminalStops = new TerminalStopTracker();
  /**
   * False once this turn has issued its first request, which is how the log
   * tells a prefix that moved between turns from one that moved mid-turn.
   */
  let coldTurn = true;
  /** The cache slot this turn's requests share, and the scope of the prefix memory. */
  const promptCacheKey = currentPromptCacheKey();
  /** Set when this turn rewrote the message history since the last request. */
  let historyRewritten = false;
  let previousSystemMessage: string | undefined;
  let requestSystemMessage: string | undefined;
  let systemMessageUpdates: string[] = [];
  /**
   * A refusal naming the context window is proof that the local estimate was
   * too low, so the round after it compacts whether or not the estimate agrees.
   * Bounded, because a history that will not shrink cannot be compacted into
   * fitting and each attempt spends a summarization call.
   */
  let overflowRecoveries = 0;
  let forceNextCompaction = false;

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
    const nextSystemMessage =
      runOverrides?.systemMessage ??
      (await services.systemMessage.getSystemMessage(
        services.toolPermissions.getState().currentMode,
      ));
    const promptDecision = decideSystemPrompt({
      previous: previousSystemMessage,
      next: nextSystemMessage,
      supportsInHistoryUpdate:
        model.chatOptions?.supportsInHistorySystemUpdates === true,
      startsSeries: previousSystemMessage === undefined,
    });
    if (promptDecision.action === "append" && promptDecision.appendedPrompt) {
      systemMessageUpdates = [
        ...systemMessageUpdates,
        promptDecision.appendedPrompt,
      ];
    } else if (promptDecision.action === "rewrite") {
      systemMessageUpdates = [];
      requestSystemMessage = nextSystemMessage;
    }
    previousSystemMessage = nextSystemMessage;
    const systemMessage = requestSystemMessage ?? nextSystemMessage;

    // Recompute tools on each iteration to handle mode changes during streaming
    const rawTools = await getRequestTools(
      isHeadless,
      runOverrides?.permissions,
      runOverrides?.canDelegate,
    );
    const tools = applyChatCompletionToolOverrides(
      rawTools,
      model.chatOptions?.toolOverrides,
    );

    const requestHeader: RequestHeader = {
      model: model.model,
      systemMessage,
      systemMessageUpdates,
      tools,
      temperature: model.defaultCompletionOptions?.temperature,
      maxTokens: model.defaultCompletionOptions?.maxTokens,
      mode: services.toolPermissions.getState().currentMode,
    };

    // Pre-API auto-compaction checkpoint (now includes tools)
    const forcingCompaction = forceNextCompaction;
    forceNextCompaction = false;
    const preCompactionResult = await handlePreApiCompaction(chatHistory, {
      model,
      llmApi,
      isCompacting,
      isHeadless,
      callbacks,
      systemMessage,
      tools,
      force: forcingCompaction,
    });
    chatHistory = preCompactionResult.chatHistory;
    if (preCompactionResult.wasCompacted) {
      compactionOccurredThisTurn = true;
      historyRewritten = true;
    }
    preApiReductionRatio = preCompactionResult.reductionRatio;

    // Compared against the last request this session sent, not only against
    // the previous iteration: a prefix that moved between turns is the case
    // that costs the most and is otherwise invisible. A compaction request
    // carries a summary prompt of its own, so it neither reports on nor
    // overwrites the session prefix.
    const previousRequestHeader = isCompacting
      ? undefined
      : recallCachePrefix(promptCacheKey);
    const cachePrefixVerdict = isCompacting
      ? undefined
      : classifyCachePrefix(previousRequestHeader, requestHeader, {
          historyRewritten,
        });
    if (cachePrefixVerdict?.state === "invalidated") {
      // Named fields rather than a hash: knowing that the tool list moved is
      // actionable, knowing that "something changed" is not.
      logger.warn("Request prefix invalidated", {
        reasons: cachePrefixVerdict.reasons,
        ...cachePrefixKeys(requestHeader),
        scenario: coldTurn ? "turn_start" : "mid_turn",
      });
    }
    if (!isCompacting) {
      rememberCachePrefix(promptCacheKey, requestHeader);
    }

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
      terminalStopMessage,
    } = await processStreamingResponse({
      isHeadless,
      chatHistory,
      model,
      llmApi,
      abortController,
      callbacks,
      tools,
      systemMessage,
      systemMessageUpdates,
      isCompacting,
      cachePrefixVerdict,
      cachePrefixComparison: {
        previous: previousRequestHeader,
        current: requestHeader,
      },
    });
    coldTurn = false;
    historyRewritten = false;

    if (abortController?.signal.aborted) {
      return finish("user_abort");
    }

    // A refusal for length is the one fault the agent can fix by changing what
    // it sends: compact, then spend the same round again. Retrying without
    // shrinking is what the old path did by throwing, which is why an oversized
    // history ended the turn instead of recovering.
    if (terminalStop === "context_overflow") {
      if (overflowRecoveries >= OVERFLOW_RECOVERIES) {
        throw new Error(
          `Context length exceeded after ${overflowRecoveries} compactions: ${terminalStopMessage ?? "the provider refused the request"}`,
        );
      }
      overflowRecoveries++;
      forceNextCompaction = true;
      logger.warn("Provider refused the request for length", {
        attempt: overflowRecoveries,
        error: terminalStopMessage,
      });
      continue;
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
      permissions: runOverrides?.permissions,
      canDelegate: runOverrides?.canDelegate,
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
      historyRewritten = true;
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
      historyRewritten = true;
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
