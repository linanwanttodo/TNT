import { randomUUID } from "node:crypto";

import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { calculateContextBudget } from "core/util/contextPolicy.js";
import { compactToolCallOutputs } from "core/util/toolResultCompaction.js";
import { encode } from "gpt-tokenizer";
import { ChatCompletionTool } from "openai/resources.mjs";

import { streamChatResponse } from "../stream/streamChatResponse.js";
import { StreamCallbacks } from "../stream/streamChatResponse.types.js";
import { buildTodoCarryContextItem, readTodoState } from "../tools/todo.js";
import { isContextLengthError } from "../utils/contextLength.js";
import { logger } from "../utils/logger.js";
import {
  countChatHistoryTokens,
  countToolDefinitionTokens,
  countTotalInputTokens,
  getModelContextLimit,
  getModelMaxTokens,
} from "../utils/tokenizer.js";

import {
  type MeasuredRequest,
  measuredInputTokens,
} from "./measuredContext.js";
import { buildSummaryRequest } from "./prefixPreservation.js";

export interface CompactionResult {
  compactedHistory: ChatHistoryItem[];
  compactionIndex: number;
  compactionContent: string;
}

export interface CompactionCallbacks {
  onStreamContent?: (content: string) => void;
  onStreamComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface CompactionOptions {
  callbacks?: CompactionCallbacks;
  abortController?: AbortController;
  systemMessageTokens?: number;
  toolResultsCompacted?: boolean;
}

const COMPACTION_PROMPT =
  "Please provide a concise summary of our conversation so far, capturing the key context, decisions made, and current state. Format this as a single comprehensive message that preserves all important information needed to continue our work. You do not need to recap the system message, as this will remain. Make sure it is clear what the current stream of work was at the very end prior to compaction so that you can continue exactly where you left off without missing any information.";

const COMPACTION_PROMPT_TOKENS = 150; // rough generous token count of ^

function messageRole(item: ChatHistoryItem | undefined): string | undefined {
  return item?.message.role;
}

function findTrailingTurnStart(
  history: ChatHistoryItem[],
  endExclusive: number,
): number {
  let start = endExclusive - 1;
  while (start > 0 && messageRole(history[start]) !== "user") {
    start--;
  }
  return messageRole(history[start]) === "user" ? start : endExclusive - 1;
}

function splitHistoryAtRetainBudget(
  history: ChatHistoryItem[],
  retainTokens: number,
  model: ModelConfig,
): { summaryHistory: ChatHistoryItem[]; retainedHistory: ChatHistoryItem[] } {
  const hasLeadingSystem = messageRole(history[0]) === "system";
  const leadingSystem = hasLeadingSystem ? history[0] : undefined;
  const body = hasLeadingSystem ? history.slice(1) : history;
  const totalBodyTokens = countChatHistoryTokens(body, model);

  if (totalBodyTokens <= retainTokens) {
    return { summaryHistory: history, retainedHistory: [] };
  }

  let start = body.length;
  let retainedTokens = 0;
  while (start > 0) {
    const turnStart = findTrailingTurnStart(body, start);
    const turnTokens = countChatHistoryTokens(
      body.slice(turnStart, start),
      model,
    );
    if (retainedTokens > 0 && retainedTokens + turnTokens > retainTokens) {
      break;
    }
    if (retainedTokens === 0 && turnTokens > retainTokens) {
      break;
    }
    retainedTokens += turnTokens;
    start = turnStart;
  }

  const summaryBody = body.slice(0, start);
  return {
    summaryHistory: leadingSystem
      ? [leadingSystem, ...summaryBody]
      : summaryBody,
    retainedHistory: body.slice(start),
  };
}

function dropOldestHistoryTurn(history: ChatHistoryItem[]): ChatHistoryItem[] {
  const firstBodyIndex = messageRole(history[0]) === "system" ? 1 : 0;
  if (firstBodyIndex >= history.length) {
    return history;
  }

  let end = firstBodyIndex + 1;
  while (end < history.length && messageRole(history[end]) !== "user") {
    end++;
  }

  return [...history.slice(0, firstBodyIndex), ...history.slice(end)];
}

interface SummaryGenerationResult {
  content: string;
  summarizedHistory: ChatHistoryItem[];
}

function reduceSummaryHistoryToHalf(
  summarizedHistory: ChatHistoryItem[],
  requestHistory: ChatHistoryItem[],
  targetTokens: number,
  model: ModelConfig,
): { summarizedHistory: ChatHistoryItem[]; requestHistory: ChatHistoryItem[] } {
  let reducedHistory = summarizedHistory;
  let reducedRequest = requestHistory;
  while (countChatHistoryTokens(reducedRequest, model) > targetTokens) {
    const nextHistory = dropOldestHistoryTurn(reducedHistory);
    if (nextHistory.length === reducedHistory.length) {
      break;
    }
    reducedHistory = nextHistory;
    reducedRequest = buildSummaryRequest(
      reducedHistory,
      COMPACTION_PROMPT,
    ).history;
  }
  return { summarizedHistory: reducedHistory, requestHistory: reducedRequest };
}

async function generateCompactionSummary(
  summarizedHistory: ChatHistoryItem[],
  requestHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  controller: AbortController,
  callbacks: CompactionCallbacks | undefined,
): Promise<SummaryGenerationResult> {
  let currentHistory = summarizedHistory;
  let currentRequest = requestHistory;
  let content = "";
  const streamCallbacks: StreamCallbacks = {
    onContent: (chunk: string) => {
      content += chunk;
      callbacks?.onStreamContent?.(chunk);
    },
    onContentComplete: () => callbacks?.onStreamComplete?.(),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    content = "";
    try {
      const response = await streamChatResponse(
        currentRequest,
        model,
        llmApi,
        controller,
        streamCallbacks,
        true,
      );
      if (!content && typeof response === "string") {
        content = response;
      }
      break;
    } catch (error) {
      if (!isContextLengthError(error) || attempt === 2) {
        throw error;
      }
      const currentTokens = countChatHistoryTokens(currentRequest, model);
      const reduced = reduceSummaryHistoryToHalf(
        currentHistory,
        currentRequest,
        Math.floor(currentTokens / 2),
        model,
      );
      if (
        reduced.summarizedHistory.length === currentHistory.length ||
        countChatHistoryTokens(reduced.requestHistory, model) >= currentTokens
      ) {
        throw error;
      }
      currentHistory = reduced.summarizedHistory;
      currentRequest = reduced.requestHistory;
    }
  }

  if (!content.trim()) {
    throw new Error("Compaction summary is empty");
  }
  return { content, summarizedHistory: currentHistory };
}

/**
 * Compacts a chat history into a summarized form
 * @param chatHistory The current chat history to compact
 * @param model The model configuration
 * @param llmApi The LLM API instance
 * @param options Optional configuration including callbacks, abort controller, and system message tokens
 * @returns The compacted history with compaction index
 */
export async function compactChatHistory(
  chatHistory: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  options?: CompactionOptions,
): Promise<CompactionResult> {
  const {
    callbacks,
    abortController,
    systemMessageTokens = 0,
    toolResultsCompacted = false,
  } = options || {};

  const historyToUse = toolResultsCompacted
    ? chatHistory
    : compactToolCallOutputs(chatHistory).history;
  const contextLimit = getModelContextLimit(model);
  const maxTokens = getModelMaxTokens(model);
  const contextBudget = calculateContextBudget(contextLimit, maxTokens);
  const { summaryHistory, retainedHistory } = splitHistoryAtRetainBudget(
    historyToUse,
    contextBudget.retainTokens,
    model,
  );
  let historyToSummarize = summaryHistory;
  let historyForCompaction = buildSummaryRequest(
    historyToSummarize,
    COMPACTION_PROMPT,
  ).history;

  // Check if system message is already in the history to avoid double-counting
  const hasSystemMessageInHistory = chatHistory.some(
    (item) => item.message.role === "system",
  );

  // Account for system message (if not already in history) AND compaction prompt
  const systemMessageReservation = hasSystemMessageInHistory
    ? 0
    : systemMessageTokens;

  const availableForInput =
    contextLimit -
    maxTokens -
    systemMessageReservation -
    COMPACTION_PROMPT_TOKENS;

  while (
    countChatHistoryTokens(historyForCompaction, model) > availableForInput &&
    historyToSummarize.length > 0
  ) {
    logger.debug("Compaction history too long, pruning oldest turn", {
      tokenCount: countChatHistoryTokens(historyForCompaction, model),
      availableForInput,
      historyLength: historyToSummarize.length,
    });
    const prunedHistory = dropOldestHistoryTurn(historyToSummarize);

    if (prunedHistory.length === historyToSummarize.length) {
      logger.warn(
        "Cannot prune history further while maintaining valid conversation structure",
      );
      break;
    }

    historyToSummarize = prunedHistory;
    historyForCompaction = buildSummaryRequest(
      historyToSummarize,
      COMPACTION_PROMPT,
    ).history;
  }

  if (countChatHistoryTokens(historyForCompaction, model) > availableForInput) {
    throw new Error("Compaction request exceeds the available context budget");
  }

  const controller = abortController || new AbortController();

  try {
    const summary = await generateCompactionSummary(
      historyToSummarize,
      historyForCompaction,
      model,
      llmApi,
      controller,
      callbacks,
    );
    const compactionContent = summary.content;

    const systemMessage = historyToUse.find(
      (item) => item.message.role === "system",
    );
    // The todo list is replayed from the Todo results in the history, so the
    // summary has to carry the list forward or a later `Todo list` call
    // reconstructs nothing.
    const todoState = readTodoState(historyToUse);
    const todoCarry = buildTodoCarryContextItem(
      todoState.todos,
      todoState.nextId,
    );
    const compactionMessage: ChatHistoryItem = {
      message: {
        role: "assistant",
        content: compactionContent,
      },
      contextItems: todoCarry ? [todoCarry] : [],
      conversationSummary: compactionContent,
      compactionCheckpoint: {
        kind: "compact-checkpoint",
        compactionId: randomUUID(),
      },
    };

    const compactedHistory: ChatHistoryItem[] = systemMessage
      ? [systemMessage, compactionMessage, ...retainedHistory]
      : [compactionMessage, ...retainedHistory];

    const originalTokens = countChatHistoryTokens(historyToUse, model);
    const compactedTokens = countChatHistoryTokens(compactedHistory, model);
    if (compactedTokens >= originalTokens) {
      throw new Error("Compaction did not reduce context usage");
    }

    return {
      compactedHistory,
      compactionContent,
      compactionIndex: systemMessage ? 1 : 0,
    };
  } catch (error) {
    logger.error("Compaction failed", error);
    callbacks?.onError?.(error as Error);
    throw error;
  }
}

/**
 * Finds the compaction index in a chat history
 * @param chatHistory The chat history to search
 * @returns The index of the compaction message, or null if not found
 */
export function findCompactionIndex(
  chatHistory: ChatHistoryItem[],
): number | null {
  const compactedIndex = chatHistory.findIndex(
    (item) =>
      item.conversationSummary !== undefined ||
      item.compactionCheckpoint?.kind === "compact-checkpoint",
  );
  return compactedIndex === -1 ? null : compactedIndex;
}

/**
 * Gets the history to send to the LLM, taking compaction into account
 * @param fullHistory The complete chat history
 * @param compactionIndex The index of the compaction message, if any
 * @returns The history to send to the LLM
 */
/**
 * Prunes chat history by removing messages from the end while ensuring
 * the history ends with either an assistant message or a tool result message
 * @param chatHistory The chat history to prune
 * @returns The pruned chat history ending with assistant or tool message
 */
export function pruneLastMessage(
  chatHistory: ChatHistoryItem[],
): ChatHistoryItem[] {
  if (chatHistory.length === 0) {
    return chatHistory;
  }

  if (chatHistory.length === 1) {
    // Only one message - always return empty array
    return [];
  }

  const secondToLastIndex = chatHistory.length - 2;
  const secondToLastItem = chatHistory[secondToLastIndex];

  if (
    secondToLastItem.message.role === "assistant" &&
    (secondToLastItem.message as any).toolCalls?.length > 0
  ) {
    return chatHistory.slice(0, -2);
  } else if (secondToLastItem.message.role === "user") {
    return chatHistory.slice(0, -2);
  }

  return chatHistory.slice(0, -1);
}

export function getHistoryForLLM(
  fullHistory: ChatHistoryItem[],
  compactionIndex: number | null,
): ChatHistoryItem[] {
  if (compactionIndex === null || compactionIndex >= fullHistory.length) {
    return fullHistory;
  }

  // Include system message (if at index 0) and everything from compaction index forward
  const systemMessage =
    fullHistory[0]?.message?.role === "system" ? fullHistory[0] : null;
  const messagesFromCompaction = fullHistory.slice(compactionIndex);

  return systemMessage && compactionIndex > 0
    ? [systemMessage, ...messagesFromCompaction]
    : messagesFromCompaction;
}

/**
 * Parameters for auto-compaction check
 */
export interface AutoCompactParams {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  systemMessage?: string;
  tools?: ChatCompletionTool[];
  /**
   * What the provider reported for the last request this session sent, and the
   * prefix it was sent under. A measured count beats a local one, which has to
   * re-encode the entire history to guess what already happened.
   */
  measured?: MeasuredRequest;
  prefixKey?: string;
}

/**
 * Get a descriptive message for auto-compaction that shows the context limit
 * @param model The model configuration
 * @returns A descriptive message explaining why compaction is needed
 */
export function getAutoCompactMessage(model: ModelConfig): string {
  const limit = getModelContextLimit(model);
  return `Approaching context limit (${(limit / 1000).toFixed(0)}K tokens). Auto-compacting chat history...`;
}

/**
 * Check if the chat history exceeds the auto-compact threshold.
 * Accounts for system message and tool definitions in the calculation.
 * @param params Object containing chatHistory, model, optional systemMessage, and optional tools
 * @returns Whether auto-compacting should be triggered
 */
export function shouldAutoCompact(params: AutoCompactParams): boolean {
  const { chatHistory, model, systemMessage, tools, measured, prefixKey } =
    params;

  // Only the items that arrived since the measurement are counted; everything
  // before them is a number the provider already gave.
  const measuredTokens = measuredInputTokens(measured, {
    historyLength: chatHistory.length,
    prefixKey,
    tailTokens: measured
      ? countChatHistoryTokens(chatHistory.slice(measured.historyLength), model)
      : 0,
  });
  const inputTokens =
    measuredTokens ??
    countTotalInputTokens({
      chatHistory,
      systemMessage,
      tools,
      model,
    });
  const contextLimit = getModelContextLimit(model);
  const maxTokens = getModelMaxTokens(model);

  const { compactAtTokens, retainTokens } = calculateContextBudget(
    contextLimit,
    maxTokens,
  );
  const compactionBuffer = contextLimit - maxTokens - compactAtTokens;

  const toolTokens = tools ? countToolDefinitionTokens(tools) : 0;
  const systemTokens = systemMessage ? encode(systemMessage).length : 0;
  const shouldCompact = inputTokens >= compactAtTokens;

  logger.debug("Context usage check", {
    inputTokens,
    fromMeasurement: measuredTokens !== undefined,
    historyTokens: countChatHistoryTokens(chatHistory, model),
    systemTokens,
    toolTokens,
    contextLimit,
    maxTokens,
    reservedForOutput: maxTokens,
    compactionBuffer,
    compactionThreshold: compactAtTokens,
    retainTokens,
    shouldCompact,
  });

  return shouldCompact;
}
