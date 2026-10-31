import type { ModelConfig } from "@tnt/config-yaml";
import type { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import type { ChatCompletionTool } from "openai/resources.mjs";

import {
  cachePrefixKeys,
  classifyCachePrefix,
  recallCachePrefix,
  rememberCachePrefix,
  type CachePrefixVerdict,
} from "../cache/prefixState.js";
import type { RequestHeader } from "../cache/requestHeader.js";
import { pruneLastMessage } from "../compaction/index.js";
import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";
import { validateContextLength } from "../utils/tokenizer.js";

import { handlePreApiCompaction } from "./streamChatResponse.compactionHelpers.js";
import type { StreamCallbacks } from "./streamChatResponse.types.js";

import { encode } from "gpt-tokenizer";

import {
  countChatHistoryItemTokens,
  countToolDefinitionTokens,
  getModelContextLimit,
  getModelMaxTokens,
} from "../utils/tokenizer.js";
import { calculateMaxOutputTokens } from "core/util/contextPolicy.js";

/**
 * The pre-request phase of one round: compact if the window is full, then say
 * whether the prefix this request sends can still be read from the provider's
 * cache. Both are decisions about the request as a whole, taken before the
 * request exists anywhere else, so they belong together rather than inline in
 * the turn loop.
 */

export interface PrepareRoundOptions {
  chatHistory: ChatHistoryItem[];
  requestHeader: RequestHeader;
  promptCacheKey?: string;
  isCompacting: boolean;
  /** False once this turn has issued its first request. */
  coldTurn: boolean;
  /** Set when the turn rewrote history since the last request. */
  historyRewritten: boolean;
  forceCompaction: boolean;
  compaction: {
    model: ModelConfig;
    llmApi: BaseLlmApi;
    isHeadless: boolean;
    callbacks?: StreamCallbacks;
    systemMessage: string;
    tools: ChatCompletionTool[];
  };
}

export interface PreparedRound {
  chatHistory: ChatHistoryItem[];
  compacted: boolean;
  /** True when a summarization call ran, as opposed to in-place trimming. */
  summarized?: boolean;
  reductionRatio?: number;
  /** The header the previous request sent under this cache key, when known. */
  previousHeader?: RequestHeader;
  /** Undefined for a compaction request, which carries a prefix of its own. */
  verdict?: CachePrefixVerdict;
}

export async function prepareRoundRequest(
  options: PrepareRoundOptions,
): Promise<PreparedRound> {
  const {
    requestHeader,
    promptCacheKey,
    isCompacting,
    coldTurn,
    historyRewritten,
    forceCompaction,
    compaction,
  } = options;

  const preCompactionResult = await handlePreApiCompaction(
    options.chatHistory,
    {
      model: compaction.model,
      llmApi: compaction.llmApi,
      isCompacting,
      isHeadless: compaction.isHeadless,
      callbacks: compaction.callbacks,
      systemMessage: compaction.systemMessage,
      tools: compaction.tools,
      force: forceCompaction,
    },
  );

  // Compared against the last request this session sent, not only against the
  // previous iteration: a prefix that moved between turns is the case that
  // costs the most and is otherwise invisible. A compaction request carries a
  // summary prompt of its own, so it neither reports on nor overwrites the
  // session prefix.
  const previousHeader = isCompacting
    ? undefined
    : recallCachePrefix(promptCacheKey);
  const verdict = isCompacting
    ? undefined
    : classifyCachePrefix(previousHeader, requestHeader, { historyRewritten });

  if (verdict?.state === "invalidated") {
    // Named fields rather than a hash: knowing that the tool list moved is
    // actionable, knowing that "something changed" is not.
    logger.warn("Request prefix invalidated", {
      reasons: verdict.reasons,
      ...cachePrefixKeys(requestHeader),
      scenario: coldTurn ? "turn_start" : "mid_turn",
    });
  }
  if (!isCompacting) {
    rememberCachePrefix(promptCacheKey, requestHeader);
  }

  return {
    chatHistory: preCompactionResult.chatHistory,
    compacted: preCompactionResult.wasCompacted,
    summarized: preCompactionResult.summarized,
    reductionRatio: preCompactionResult.reductionRatio,
    previousHeader,
    verdict,
  };
}

/**
 * Prunes trailing messages until the request fits the model's context window,
 * counting the system message, its updates and the tool list. A request that
 * still does not fit after pruning throws rather than reaching the provider.
 *
 * Returns the possibly shortened history and the token budget the provider
 * call must carry as `max_tokens`.
 */
export function pruneHistoryToContextLimit(options: {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  systemMessage: string;
  systemMessageUpdates: readonly string[];
  tools?: ChatCompletionTool[];
}): { chatHistory: ChatHistoryItem[]; maxTokens?: number } {
  const { model, systemMessage, systemMessageUpdates, tools } = options;
  let history = options.chatHistory;

  // Safety buffer to account for tokenization estimation errors
  const SAFETY_BUFFER = 100;

  // Fixed parts of the count, computed once: re-tokenizing the system message
  // and the tool list per prune would be wasted work, since pruning only
  // removes history items. The in-history updates are separate messages the
  // request really sends, so they count here even though pruning never
  // touches them (per message: content + role overhead + the per-item
  // structure overhead the history count would have added).
  const systemTokens = systemMessage ? encode(systemMessage).length + 4 : 0;
  const updateTokens = systemMessageUpdates.reduce(
    (sum, content) => sum + encode(content).length + 5,
    0,
  );
  const toolTokens = tools?.length ? countToolDefinitionTokens(tools) : 0;
  // Per-item counts are computed once too. validateContextLength re-encodes
  // the whole history, which made the prune loop quadratic on long sessions;
  // subtracting the dropped item's own count keeps the same arithmetic at
  // O(n) after the first pass.
  const itemTokens = history.map(
    (item) => countChatHistoryItemTokens(item, model) + 3,
  );
  const historyTokens = itemTokens.reduce((sum, n) => sum + n, 0);
  const contextLimit = getModelContextLimit(model);
  const configuredMaxTokens = getModelMaxTokens(model);
  const totalWith = (tokens: number) => {
    const reservedForOutput = calculateMaxOutputTokens(
      contextLimit,
      tokens,
      configuredMaxTokens,
      Math.max(SAFETY_BUFFER, 64),
    );
    return {
      reservedForOutput,
      isValid:
        reservedForOutput > 0 &&
        tokens + reservedForOutput + SAFETY_BUFFER <= contextLimit,
      maxTokens: reservedForOutput,
    };
  };

  const fixedTokens = systemTokens + updateTokens + toolTokens;
  let historyCount = historyTokens;
  let validation = totalWith(historyCount + fixedTokens);
  while (history.length > 1 && !validation.isValid) {
    const prunedChatHistory = pruneLastMessage(history);
    if (prunedChatHistory.length === history.length) {
      break;
    }
    historyCount -= itemTokens[history.length - 1] ?? 0;
    history = prunedChatHistory;
    validation = totalWith(historyCount + fixedTokens);
  }
  if (!validation.isValid) {
    throw new Error(
      t("stream.contextValidationFailed", {
        error: "the pruned history still exceeds the context limit",
      }),
    );
  }

  return { chatHistory: history, maxTokens: validation.maxTokens };
}
