import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import * as dotenv from "dotenv";

import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import { type RequestHeader } from "../cache/requestHeader.js";
import { noteMeasuredRequest } from "../compaction/measuredContext.js";
import { noteRequestSent } from "../compaction/microCompact.js";
import { t } from "../i18n/index.js";
import { OVERFLOW_RECOVERIES } from "../loop/terminalStop.js";
import { getModelContextLimit } from "../utils/tokenizer.js";
import {
  REQUEST_TIMEOUT_ABORT,
  describeTermination,
  type TerminationReason,
} from "../loop/termination.js";
import { type TurnBudgetLimits } from "../loop/turnBudget.js";
import { services } from "../services/index.js";
import { applyChatCompletionToolOverrides } from "../tools/applyToolOverrides.js";
import { readTodoState } from "../tools/todo.js";
import { logger } from "../utils/logger.js";

import { getRequestTools, handleToolCalls } from "./handleToolCalls.js";
import { processStreamingResponse } from "./processStreamingResponse.js";
import { prepareRoundRequest } from "./requestPreparation.js";
import {
  handleAutoContinuation,
  handleContentDisplay,
  refreshChatHistoryFromService,
  updateFinalResponse,
} from "./responseChunks.js";
import { classifyRoundOutcome } from "./roundOutcome.js";
import {
  handleNormalAutoCompaction,
  handlePostToolValidation,
} from "./streamChatResponse.compactionHelpers.js";
import {
  StreamCallbacks,
  StreamRunOverrides,
} from "./streamChatResponse.types.js";
import { advanceSystemPrompt } from "./systemPromptRound.js";
import {
  createTurnState,
  noteCompaction,
  noteOverflowRecovery,
  noteRequestCompleted,
  takeForcedCompaction,
} from "./turnState.js";

// Re-exported because the per-request seam is tested through this module.
export { processStreamingResponse };

dotenv.config();

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
  // Frozen for the whole turn: a mode switch between rounds must not rewrite
  // the prompt or the request header under the cached prefix.
  const mode =
    runOverrides?.mode ?? services.toolPermissions.getState().currentMode;

  let fullResponse = "";
  let finalResponse = "";
  /** The cache slot this turn's requests share, and the scope of the prefix memory. */
  const promptCacheKey = currentPromptCacheKey();
  // Counters and flags for this user turn, in one owner. The budget's limits
  // come from configuration and the system prompt series is borrowed from the
  // session-scoped registry (so a new turn does not rewrite the cached head);
  // everything else resets with the next prompt.
  const state = createTurnState(
    turnBudgetLimits,
    promptCacheKey,
    runOverrides?.systemMessage,
  );

  /**
   * End the turn, tell the caller why, and return the text produced so far.
   * Every exit from the loop goes through here so no path can end silently.
   */
  const finish = (reason: TerminationReason): string => {
    callbacks?.onTurnTerminated?.(reason, {
      maxSteps: state.budget.limits.maxSteps,
      notice: describeTermination(reason, {
        maxSteps: state.budget.limits.maxSteps,
      }),
    });
    logger.debug("streamChatResponse terminated", {
      reason,
      steps: state.budget.stepsDone,
      totalResponseLength: fullResponse.length,
      totalMessages: chatHistory.length,
    });
    return isHeadless ? finalResponse : fullResponse;
  };

  while (true) {
    // The abort signal used to be ignored here, so a cancelled turn kept
    // requesting models until one of them happened to return no tool calls.
    if (abortController?.signal.aborted) {
      return finish(
        abortController.signal.reason === REQUEST_TIMEOUT_ABORT
          ? "request_timeout"
          : "user_abort",
      );
    }

    // Checked before the round rather than after, so a turn that is already
    // over budget stops instead of spending one more round to find that out.
    if (state.budget.stepsExhausted) {
      return finish("max_steps");
    }

    // If ChatHistoryService is available, refresh local chatHistory view
    chatHistory = refreshChatHistoryFromService(chatHistory, isCompacting);
    // Reduction ratios reported by this round's three compaction checkpoints are
    // declared where they are measured, then read together below.
    logger.debug("Starting conversation iteration");

    // Get system message once per iteration (can change based on tool permissions mode)
    const nextSystemMessage =
      runOverrides?.systemMessage ??
      (await services.systemMessage.getSystemMessage(mode));
    // The round advances the prompt state in place; the loop only reads what
    // this request sends.
    const advancedPrompt = advanceSystemPrompt({
      state: state.systemPrompt,
      next: nextSystemMessage,
      modelName: model.model,
      supportsInHistoryUpdate:
        model.chatOptions?.supportsInHistorySystemUpdates,
      carriesInHistory:
        llmApi.carriesInHistorySystemMessages?.(model.model) === true,
    });
    for (const warning of advancedPrompt.warnings) {
      logger.warn(warning);
    }
    const systemMessage = advancedPrompt.systemMessage;

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
      systemMessageUpdates: state.systemPrompt.updates,
      tools,
      temperature: model.defaultCompletionOptions?.temperature,
      maxTokens: model.defaultCompletionOptions?.maxTokens,
      mode,
    };

    // Pre-API auto-compaction checkpoint (now includes tools)
    const forcingCompaction = takeForcedCompaction(state);
    const prepared = await prepareRoundRequest({
      chatHistory,
      requestHeader,
      promptCacheKey,
      isCompacting,
      coldTurn: state.coldTurn,
      historyRewritten: state.historyRewritten,
      forceCompaction: forcingCompaction,
      compaction: {
        model,
        llmApi,
        isHeadless,
        callbacks,
        systemMessage,
        tools,
      },
    });
    chatHistory = prepared.chatHistory;
    if (prepared.compacted) {
      noteCompaction(state);
    }
    const preApiReductionRatio = prepared.reductionRatio;
    const preApiSummarized = prepared.summarized === true;
    const previousRequestHeader = prepared.previousHeader;
    const cachePrefixVerdict = prepared.verdict;

    logger.debug("Tools prepared", {
      toolCount: tools.length,
      toolNames: tools.map((t) => t.function.name),
    });

    // The request is about to go out, which is what the next turn's cache gap is
    // measured from.
    noteRequestSent();

    // Get response from LLM
    const {
      content,
      toolCalls,
      shouldContinue,
      usage,
      loopDetection,
      terminalStop,
      terminalStopMessage,
      reasoning,
    } = await processStreamingResponse({
      isHeadless,
      chatHistory,
      model,
      llmApi,
      abortController,
      callbacks,
      tools,
      systemMessage,
      systemMessageUpdates: state.systemPrompt.updates,
      isCompacting,
      cachePrefixVerdict,
      cachePrefixComparison: {
        previous: previousRequestHeader,
        current: requestHeader,
      },
    });
    noteRequestCompleted(state);
    // What the provider measured for this request is the honest fullness of the
    // window; a local count of the whole history is neither measured nor cheap.
    state.contextBudget.recordRequest(usage?.promptTokens);
    noteMeasuredRequest(promptCacheKey, usage ?? {}, {
      historyLength: chatHistory.length,
    });

    const outcome = classifyRoundOutcome({
      aborted: abortController?.signal.aborted === true,
      abortReason: abortController?.signal.reason,
      terminalStop,
      loopDetection,
      overflowRecoveries: state.overflowRecoveries,
      maxOverflowRecoveries: OVERFLOW_RECOVERIES,
    });

    if (outcome.kind === "abort") {
      fullResponse += content;
      finalResponse = updateFinalResponse(
        content,
        false,
        isHeadless,
        finalResponse,
      );
      handleContentDisplay(content, callbacks, isHeadless);
      await handleToolCalls({
        toolCalls: [],
        chatHistory,
        content,
        callbacks,
        isHeadless,
        usage,
        reasoning,
      });
      return finish(outcome.reason);
    }

    // A refusal for length is the one fault the agent can fix by changing what
    // it sends: compact, then spend the same round again. Retrying without
    // shrinking is what the old path did by throwing, which is why an oversized
    // history ended the turn instead of recovering.
    if (outcome.kind === "overflow") {
      if (outcome.exhausted) {
        throw new Error(
          t("stream.contextLengthExceededAfterCompactions", {
            count: state.overflowRecoveries,
            reason: terminalStopMessage ?? t("stream.providerRefusedRequest"),
          }),
        );
      }
      noteOverflowRecovery(state, OVERFLOW_RECOVERIES);
      logger.warn("Provider refused the request for length", {
        attempt: state.overflowRecoveries,
        error: terminalStopMessage,
      });
      continue;
    }

    // Retry only while this kind of fault still has budget. Once the budget is
    // gone the turn ends, because retrying an unchanging fault only spends
    // tokens to arrive at the same place.
    if (outcome.kind === "terminal") {
      if (state.terminalStops.shouldRetry(outcome.stop)) {
        logger.debug("Retrying round after early stream end", {
          kind: outcome.stop,
          attempt: state.terminalStops.retriesUsed(outcome.stop),
        });
        continue;
      }
      return finish("stream_stall");
    }

    if (outcome.kind === "loop") {
      logger.warn("Repetitive output detected", {
        kind: outcome.detection.kind,
        repetitions: outcome.detection.repetitions,
        fingerprint: outcome.detection.fingerprint,
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
      // A list nobody updates is a list that lies, so after ten tool calls
      // without a Todo update the reminder rides the next tool result - the
      // request tail, not the cached prefix. The context notice shares the
      // channel for the same reason.
      callbacks: {
        ...callbacks,
        onTailReminder: (toolName, argumentsJson) => {
          const notes = [
            // Same source as every other window read: the model-level
            // contextLength must reach the context notice too, not just
            // defaultCompletionOptions.
            state.contextBudget.reminder(getModelContextLimit(model)),
            state.todoReminder.recordToolResult(
              toolName,
              readTodoState().todos,
            ),
            state.repeatCallGuard.record(toolName, argumentsJson),
          ].filter((note): note is string => Boolean(note));
          return notes.length > 0 ? notes.join("\n\n") : undefined;
        },
      },
      isHeadless,
      usage,
      reasoning,
      permissions: runOverrides?.permissions,
      canDelegate: runOverrides?.canDelegate,
      llmApi,
      model,
      signal: abortController?.signal,
      onToolOutcome: (toolName, succeeded, error) => {
        const notice = state.toolFailures.record(toolName, succeeded, error);
        if (notice) {
          // Operator-facing only: the model is not told about this streak, and
          // the tally exists so a log reader can see the repeated failure.
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
      noteCompaction(state);
    }
    const postToolReductionRatio = postToolResult.reductionRatio;

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
      noteCompaction(state);
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
    // Only a round that actually ran a summarization counts toward the
    // compaction circuit. In-place tool-result trimming rewrites the history
    // too, but spends no model call and often removes very little, so charging
    // it as a failed compaction would end a healthy turn after three ordinary
    // tool rounds.
    const compactionSummarized =
      preApiSummarized ||
      postToolResult.summarized === true ||
      compactionResult.summarized === true;
    const compactionWasWorthwhile =
      state.compactionOccurred && compactionSummarized
        ? state.budget.recordCompaction(reductionRatio)
        : true;

    // Once summarization has failed this many times the context is not going to
    // recover on its own, and each retry spends another summarization call.
    if (
      state.compactionOccurred &&
      compactionSummarized &&
      state.budget.compactionCircuitOpen
    ) {
      return finish("compaction_circuit_open");
    }

    // Charge the round to the budget. A round that ran a tool moved the task
    // forward, however short the model's own output was, so only the round
    // ceiling can end the turn here.
    const budgetState = state.budget.recordStep();
    if (budgetState === "steps_exhausted") {
      return finish("max_steps");
    }

    // If compaction happened during this turn and we're about to stop,
    // automatically send a continuation message to keep the agent going
    // Only a summarization checkpoint is worth continuing for. In-place
    // tool-result trimming rewrites old rows on ordinary tool rounds and must
    // not turn a finished answer into another round.
    const autoContinueResult = handleAutoContinuation(
      state.compactionOccurred && compactionSummarized,
      shouldContinue,
      chatHistory,
      compactionWasWorthwhile,
    );
    chatHistory = autoContinueResult.chatHistory;
    const shouldAutoContinue = autoContinueResult.shouldAutoContinue;

    // Reset flag to avoid infinite continuation
    if (shouldAutoContinue) {
      state.compactionOccurred = false;
    }

    // Check if we should continue (skip the end if auto-continuing after
    // compaction). Goes through finish so the caller still learns the turn
    // ended, rather than the loop breaking quietly.
    if (!shouldContinue && !shouldAutoContinue) {
      return finish("no_tool_calls");
    }
  }
}
