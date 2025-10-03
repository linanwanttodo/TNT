import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem, Session } from "core/index.js";
import {
  createAutoCompactionState,
  isCompactionBreakerTripped,
  recordCompactionFailure,
  recordCompactionSuccess,
  type AutoCompactionState,
} from "core/util/autoCompaction.js";
import { compactToolCallOutputs } from "core/util/toolResultCompaction.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";
import React from "react";

import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import {
  compactChatHistory,
  findCompactionIndex,
  getAutoCompactMessage,
  shouldAutoCompact,
} from "../compaction/index.js";
import { measuredRequestFor } from "../compaction/measuredContext.js";
import type { OutputFormat } from "../config/outputFormat.js";
import { firePreCompact } from "../hooks/fireHook.js";
import {
  getCurrentSession,
  getSessionHistoryGeneration,
  replaceSessionHistoryIfGeneration,
} from "../session/index.js";
import { formatError } from "../utils/formatError.js";
import { logger } from "../utils/logger.js";

import { summarizeWithEngine } from "./summarizeWithEngine.js";

const compactionStateBySession = new WeakMap<Session, AutoCompactionState>();

function getCompactionState(session: Session): AutoCompactionState {
  let state = compactionStateBySession.get(session);
  if (!state) {
    state = createAutoCompactionState();
    compactionStateBySession.set(session, state);
  }
  return state;
}

function setCompactionState(
  session: Session,
  state: AutoCompactionState,
): void {
  compactionStateBySession.set(session, state);
}

interface AutoCompactionCallbacks {
  // For streaming mode
  onSystemMessage?: (message: string) => void;
  onContent?: (content: string) => void;

  // For TUI mode
  setMessages?: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>;
  setChatHistory?: React.Dispatch<React.SetStateAction<ChatHistoryItem[]>>;
  setCompactionIndex?: React.Dispatch<React.SetStateAction<number | null>>;

  // For headless mode - no callbacks needed, just return values
}

interface AutoCompactionOptions {
  isHeadless?: boolean;
  format?: OutputFormat;
  callbacks?: AutoCompactionCallbacks;
  systemMessage?: string;
  tools?: ChatCompletionTool[];
  /**
   * Summarize without asking the threshold. The caller uses it when evidence
   * from outside the local estimate says the history does not fit, most often
   * the provider's own refusal for length.
   */
  force?: boolean;
}

/**
 * Notify user about compaction start
 */
function notifyCompactionStart(
  message: string,
  isHeadless: boolean,
  callbacks?: AutoCompactionCallbacks,
) {
  if (isHeadless) return;

  if (callbacks?.onSystemMessage) {
    callbacks.onSystemMessage(message);
  } else if (callbacks?.setMessages) {
    // TUI mode - handled by caller
  }
}

/**
 * Handle successful compaction state updates
 */
function handleCompactionSuccess(
  result: any,
  isHeadless: boolean,
  callbacks?: AutoCompactionCallbacks,
) {
  if (isHeadless) return;

  const successMessage = "Chat history auto-compacted successfully.";

  if (callbacks?.onSystemMessage) {
    callbacks.onSystemMessage(successMessage);
  } else if (
    callbacks?.setMessages &&
    callbacks?.setChatHistory &&
    callbacks?.setCompactionIndex
  ) {
    callbacks.setChatHistory(result.compactedHistory);
    callbacks.setCompactionIndex(result.compactionIndex);
    callbacks.setMessages((prev: ChatHistoryItem[]) => [
      ...prev,
      {
        message: {
          role: "system",
          content: successMessage,
        },
        contextItems: [],
      },
    ]);
  }
}

/**
 * Handle compaction error notification
 */
function handleCompactionError(
  error: any,
  isHeadless: boolean,
  callbacks?: AutoCompactionCallbacks,
) {
  const errorMessage = `Auto-compaction error: ${formatError(error)}`;
  logger.error(errorMessage);

  if (isHeadless) return;

  const warningMessage = `Warning: ${errorMessage}. Continuing without compaction...`;

  if (callbacks?.onSystemMessage) {
    callbacks.onSystemMessage(warningMessage);
  } else if (callbacks?.setMessages) {
    callbacks.setMessages((prev: ChatHistoryItem[]) => [
      ...prev,
      {
        message: {
          role: "system",
          content: warningMessage,
        },
        contextItems: [],
      },
    ]);
  }
}

/**
 * Unified auto-compaction handler for all modes (streaming, TUI, headless)
 * @param chatHistory Current chat history
 * @param model Model configuration
 * @param llmApi LLM API instance
 * @param options Configuration options for different usage contexts
 * @returns Updated chat history and compaction index, or original if no compaction needed
 */
export async function handleAutoCompaction(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  options: AutoCompactionOptions = {},
): Promise<{
  chatHistory: ChatHistoryItem[];
  compactionIndex: number | null;
  wasCompacted: boolean;
}> {
  const {
    isHeadless = false,
    callbacks,
    systemMessage: providedSystemMessage,
    tools,
    force,
  } = options;

  if (!model) {
    return { chatHistory, compactionIndex: null, wasCompacted: false };
  }

  const session = getCurrentSession();
  const initialGeneration = getSessionHistoryGeneration();
  let compactionState = getCompactionState(session);
  if (compactionState.inFlight) {
    return {
      chatHistory: session.history,
      compactionIndex: findCompactionIndex(session.history),
      wasCompacted: false,
    };
  }

  const toolResultCompaction = compactToolCallOutputs(chatHistory);
  const historyAfterToolResultCompaction = toolResultCompaction.history;
  const compactionIndex = findCompactionIndex(historyAfterToolResultCompaction);
  let expectedGeneration = initialGeneration;

  if (toolResultCompaction.truncatedCount > 0) {
    const persisted = replaceSessionHistoryIfGeneration(
      expectedGeneration,
      historyAfterToolResultCompaction,
    );
    if (!persisted) {
      const latestHistory = getCurrentSession().history;
      return {
        chatHistory: latestHistory,
        compactionIndex: findCompactionIndex(latestHistory),
        wasCompacted: false,
      };
    }
    expectedGeneration = getSessionHistoryGeneration();
    callbacks?.setChatHistory?.(historyAfterToolResultCompaction);
    callbacks?.setCompactionIndex?.(compactionIndex);
  }

  const prefixKey = currentPromptCacheKey();
  const shouldSummarize =
    !isCompactionBreakerTripped(compactionState) &&
    (force === true ||
      shouldAutoCompact({
        chatHistory: historyAfterToolResultCompaction,
        model,
        systemMessage: providedSystemMessage,
        tools,
        // The provider's own number for the request sent under this same prefix,
        // refused by `shouldAutoCompact` itself if the history has since shrunk.
        measured: measuredRequestFor(prefixKey),
        prefixKey,
      }));
  if (!shouldSummarize) {
    if (toolResultCompaction.truncatedCount === 0) {
      return { chatHistory, compactionIndex: null, wasCompacted: false };
    }

    return {
      chatHistory: historyAfterToolResultCompaction,
      compactionIndex,
      wasCompacted: true,
    };
  }

  logger.info(
    `Auto-compaction triggered${isHeadless ? " in headless mode" : ""}`,
  );

  // PreCompact has to run before the history is summarized, and in every surface
  // that compacts: it is the hook an operator uses to keep a full transcript, and
  // the reference lets it refuse. A refusal is obeyed - the run continues with
  // what it has, so an oversized request is reported rather than compacted behind
  // the hook's back.
  const preCompact = await firePreCompact("auto");
  if (preCompact.blocked) {
    logger.info("PreCompact hook refused the summarization; continuing as-is");
    return {
      chatHistory: historyAfterToolResultCompaction,
      compactionIndex,
      wasCompacted: toolResultCompaction.truncatedCount > 0,
    };
  }

  compactionState = { ...compactionState, inFlight: true };
  setCompactionState(session, compactionState);

  // Notify about compaction start
  notifyCompactionStart(getAutoCompactMessage(model), isHeadless, callbacks);

  try {
    // Get system message to calculate its token count for compaction pruning
    // Use provided message if available, otherwise fetch it (for backward compatibility)
    const systemMessage =
      providedSystemMessage ??
      (async () => {
        const { services } = await import("../services/index.js");
        return services.systemMessage.getSystemMessage(
          services.toolPermissions.getState().currentMode,
        );
      })();
    const resolvedSystemMessage =
      typeof systemMessage === "string" ? systemMessage : await systemMessage;

    const { countChatHistoryItemTokens } = await import(
      "../utils/tokenizer.js"
    );
    const systemMessageTokens = countChatHistoryItemTokens(
      {
        message: {
          role: "system",
          content: resolvedSystemMessage,
        },
        contextItems: [],
      },
      model,
    );

    // Compact the history
    const result = await compactChatHistory(
      historyAfterToolResultCompaction,
      model,
      llmApi,
      {
        callbacks: isHeadless
          ? undefined
          : {
              onStreamContent: callbacks?.onContent,
              onStreamComplete: () => {},
            },
        systemMessageTokens,
        toolResultsCompacted: true,
        summarize: summarizeWithEngine,
      },
    );

    const persisted = replaceSessionHistoryIfGeneration(
      expectedGeneration,
      result.compactedHistory,
    );
    if (!persisted) {
      setCompactionState(session, { ...compactionState, inFlight: false });
      const latestHistory = getCurrentSession().history;
      return {
        chatHistory: latestHistory,
        compactionIndex: findCompactionIndex(latestHistory),
        wasCompacted: false,
      };
    }

    compactionState = recordCompactionSuccess(compactionState);
    setCompactionState(session, compactionState);

    // Handle success notification
    handleCompactionSuccess(result, isHeadless, callbacks);

    return {
      chatHistory: result.compactedHistory,
      compactionIndex: result.compactionIndex,
      wasCompacted: true,
    };
  } catch (error: any) {
    // Handle error notification
    handleCompactionError(error, isHeadless, callbacks);
    compactionState =
      toolResultCompaction.truncatedCount > 0
        ? { ...compactionState, inFlight: false }
        : recordCompactionFailure(compactionState);
    setCompactionState(session, compactionState);

    if (toolResultCompaction.truncatedCount > 0) {
      return {
        chatHistory: historyAfterToolResultCompaction,
        compactionIndex,
        wasCompacted: true,
      };
    }

    // Continue without compaction on error
    return { chatHistory, compactionIndex: null, wasCompacted: false };
  }
}
