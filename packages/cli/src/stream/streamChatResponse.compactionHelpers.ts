import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";

import {
  cacheGapMs,
  isCacheCold,
  microCompactHistory,
} from "../compaction/microCompact.js";
import { services } from "../services/index.js";
import { ToolCall } from "../tools/index.js";
import { logger } from "../utils/logger.js";
import { validateContextLength } from "../utils/tokenizer.js";

import { handleAutoCompaction } from "./streamChatResponse.autoCompaction.js";
import { StreamCallbacks } from "./streamChatResponse.types.js";

export interface CompactionHelperOptions {
  model: ModelConfig;
  llmApi: BaseLlmApi;
  isCompacting: boolean;
  isHeadless: boolean;
  callbacks?: StreamCallbacks;
  systemMessage: string;
  tools?: ChatCompletionTool[];
  /**
   * Compact without waiting for the estimate to agree. Used when something
   * outside the estimate proved the history does not fit - the provider's own
   * refusal, or a tool result that pushed past the local limit.
   */
  force?: boolean;
}

/**
 * Result of a compaction attempt.
 *
 * `reductionRatio` is the fraction of history entries the compaction removed,
 * measured where the compaction actually happened rather than inferred later.
 * A compaction that ran but removed almost nothing still spent a summarization
 * call, so the caller needs the ratio to decide whether to keep going.
 */
export interface CompactionHelperResult {
  chatHistory: ChatHistoryItem[];
  wasCompacted: boolean;
  /** Fraction of history entries removed, present only when compaction ran. */
  reductionRatio?: number;
}

/**
 * Fraction of history entries a compaction removed, or undefined when the
 * history did not shrink. Compared on entry counts rather than tokens because
 * this runs on every compaction and a token count would cost a tokenizer pass.
 */
function measureReduction(
  before: ChatHistoryItem[],
  after: ChatHistoryItem[],
): number | undefined {
  if (after.length >= before.length || before.length === 0) {
    return undefined;
  }
  return (before.length - after.length) / before.length;
}

/**
 * Handle pre-API auto-compaction if needed
 */
export async function handlePreApiCompaction(
  chatHistory: ChatHistoryItem[],
  options: CompactionHelperOptions,
): Promise<CompactionHelperResult> {
  const {
    model,
    llmApi,
    isCompacting,
    isHeadless,
    callbacks,
    systemMessage,
    tools,
    force,
  } = options;

  if (isCompacting) {
    return { chatHistory, wasCompacted: false };
  }

  // Before anything token-shaped is considered: a request that arrives after the
  // provider's cache has expired is paying full price for old tool results, so
  // their bulk goes first. It is the cheapest reduction available and it leaves the
  // conversation's shape alone.
  if (isCacheCold()) {
    const micro = microCompactHistory(chatHistory);
    if (micro.clearedResults > 0) {
      logger.info("Micro-compacted after a cache gap", {
        clearedResults: micro.clearedResults,
        droppedChars: micro.droppedChars,
        gapMs: cacheGapMs(),
      });
      const svc = services.chatHistory;
      if (typeof svc?.isReady === "function" && svc.isReady()) {
        svc.setHistory(micro.history);
        chatHistory = svc.getHistory();
      } else {
        chatHistory = micro.history;
      }
    }
  }

  const { wasCompacted, chatHistory: preCompactHistory } =
    await handleAutoCompaction(chatHistory, model, llmApi, {
      isHeadless,
      callbacks: {
        onSystemMessage: callbacks?.onSystemMessage,
        onContent: callbacks?.onContent,
      },
      systemMessage,
      tools,
      force,
    });

  if (wasCompacted) {
    logger.debug("Pre-API compaction occurred, updating chat history");
    const reductionRatio = measureReduction(chatHistory, preCompactHistory);
    const chatHistorySvc = services.chatHistory;
    if (
      typeof chatHistorySvc?.isReady === "function" &&
      chatHistorySvc.isReady()
    ) {
      chatHistorySvc.setHistory(preCompactHistory);
      return {
        chatHistory: chatHistorySvc.getHistory(),
        wasCompacted: true,
        reductionRatio,
      };
    }
    return {
      chatHistory: [...preCompactHistory],
      wasCompacted: true,
      reductionRatio,
    };
  }

  return { chatHistory, wasCompacted: false };
}

/**
 * Validate and handle context overflow after tool execution
 */
export async function handlePostToolValidation(
  toolCalls: ToolCall[],
  chatHistory: ChatHistoryItem[],
  options: CompactionHelperOptions,
): Promise<CompactionHelperResult> {
  const { model, llmApi, isHeadless, callbacks, systemMessage, tools } =
    options;

  if (toolCalls.length === 0) {
    return { chatHistory, wasCompacted: false };
  }

  // Get updated history after tool execution
  const chatHistorySvc = services.chatHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    chatHistory = chatHistorySvc.getHistory();
  }

  const SAFETY_BUFFER = 100;
  const postToolValidation = validateContextLength({
    chatHistory,
    model,
    safetyBuffer: SAFETY_BUFFER,
    systemMessage,
    tools,
  });

  // If tool results pushed us over limit, force compaction regardless of threshold
  if (!postToolValidation.isValid) {
    logger.warn("Tool execution caused context overflow, forcing compaction", {
      inputTokens: postToolValidation.inputTokens,
      contextLimit: postToolValidation.contextLimit,
    });

    // Force compaction (compaction now accounts for system message during pruning)
    const { wasCompacted, chatHistory: compactedHistory } =
      await handleAutoCompaction(chatHistory, model, llmApi, {
        isHeadless,
        callbacks: {
          onSystemMessage: callbacks?.onSystemMessage,
          onContent: callbacks?.onContent,
        },
        systemMessage,
        tools,
        force: true,
      });

    if (wasCompacted) {
      const reductionRatio = measureReduction(chatHistory, compactedHistory);
      // Use the service to update history if available, otherwise use local copy
      if (chatHistorySvc && typeof chatHistorySvc.setHistory === "function") {
        chatHistorySvc.setHistory(compactedHistory);
        chatHistory = chatHistorySvc.getHistory();
      } else {
        // Fallback: use the compacted history directly when service unavailable
        chatHistory = compactedHistory;
      }

      // Verify compaction brought us under the limit
      const postCompactionValidation = validateContextLength({
        chatHistory,
        model,
        safetyBuffer: SAFETY_BUFFER,
        systemMessage,
        tools,
      });

      if (!postCompactionValidation.isValid) {
        logger.error(
          "Compaction failed to bring context under limit, stopping execution",
          {
            inputTokens: postCompactionValidation.inputTokens,
            contextLimit: postCompactionValidation.contextLimit,
          },
        );
        throw new Error(
          `Context limit exceeded even after compaction: ${postCompactionValidation.error}`,
        );
      }

      logger.info("Successfully compacted after tool overflow", {
        inputTokens: postCompactionValidation.inputTokens,
        contextLimit: postCompactionValidation.contextLimit,
      });
      return { chatHistory, wasCompacted: true, reductionRatio };
    } else {
      // Compaction failed, cannot continue
      logger.error("Failed to compact history after tool execution overflow");
      throw new Error(
        "Context limit exceeded and compaction failed. Unable to continue.",
      );
    }
  }

  return { chatHistory, wasCompacted: false };
}

/**
 * Handle normal auto-compaction check at 80% threshold
 */
export async function handleNormalAutoCompaction(
  chatHistory: ChatHistoryItem[],
  shouldContinue: boolean,
  options: CompactionHelperOptions,
): Promise<CompactionHelperResult> {
  const { model, llmApi, isHeadless, callbacks, systemMessage, tools } =
    options;

  if (!shouldContinue) {
    return { chatHistory, wasCompacted: false };
  }

  const chatHistorySvc = services.chatHistory;
  if (
    typeof chatHistorySvc?.isReady === "function" &&
    chatHistorySvc.isReady()
  ) {
    chatHistory = chatHistorySvc.getHistory();
  }

  const { wasCompacted, chatHistory: updatedChatHistory } =
    await handleAutoCompaction(chatHistory, model, llmApi, {
      isHeadless,
      callbacks: {
        onSystemMessage: callbacks?.onSystemMessage,
        onContent: callbacks?.onContent,
      },
      systemMessage,
      tools,
    });

  if (wasCompacted) {
    const reductionRatio = measureReduction(chatHistory, updatedChatHistory);
    // Use the service to update history if available, otherwise use local copy
    if (chatHistorySvc && typeof chatHistorySvc.setHistory === "function") {
      chatHistorySvc.setHistory(updatedChatHistory);
      return {
        chatHistory: chatHistorySvc.getHistory(),
        wasCompacted: true,
        reductionRatio,
      };
    }
    // Fallback: return the compacted history directly when service unavailable
    return {
      chatHistory: updatedChatHistory,
      wasCompacted: true,
      reductionRatio,
    };
  }

  return { chatHistory, wasCompacted: false };
}
