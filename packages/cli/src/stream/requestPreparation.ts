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
import { logger } from "../utils/logger.js";

import { handlePreApiCompaction } from "./streamChatResponse.compactionHelpers.js";
import type { StreamCallbacks } from "./streamChatResponse.types.js";

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
