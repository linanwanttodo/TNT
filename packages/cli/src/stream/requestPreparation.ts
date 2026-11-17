import type { ModelConfig } from "@tnt/config-yaml";
import type { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";
import { cacheReadDiscountRatio } from "core/llm/utils/calculateRequestCost.js";
import { calculateMaxOutputTokens } from "core/util/contextPolicy.js";
import { encode } from "gpt-tokenizer";
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
import { measuredRequestFor } from "../compaction/measuredContext.js";
import { cacheGapMs, isCacheCold } from "../compaction/microCompact.js";
import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";
import {
  countChatHistoryItemTokens,
  countToolDefinitionTokens,
  getModelContextLimit,
  getModelMaxTokens,
} from "../utils/tokenizer.js";

import { formatInHistoryUpdate } from "./requestMessages.js";
import { handlePreApiCompaction } from "./streamChatResponse.compactionHelpers.js";
import type { StreamCallbacks } from "./streamChatResponse.types.js";
import {
  evictOldToolResults,
  shouldApplyWarmEviction,
} from "./toolOutputEviction.js";

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
  /**
   * The sender's own identity for the client-side prefix memory and the
   * eviction bookkeeping. A delegated run passes its own id so its verdicts
   * compare against its own previous request instead of the parent's, whose
   * header a shared routing key would otherwise clobber in both directions.
   * Defaults to the routing key.
   */
  prefixScope?: string;
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
    prefixScope,
    isCompacting,
    coldTurn,
    historyRewritten,
    forceCompaction,
    compaction,
  } = options;
  const prefixMemoryScope = prefixScope ?? promptCacheKey;

  // Evict dead tool-output bytes before anything else reads the history: the
  // compaction check and the request itself should both see the trimmed form,
  // so a session that carries a lot of old tool output does not have to reach
  // the compaction threshold to stop paying for it. A compaction request
  // summarizes its own prefix and skips the eviction.
  //
  // Growth of the evicted set is gated on the cache's temperature. Every newly
  // swallowed position moves the cached prefix and re-pays the tail at full
  // price, so on a warm cache growth waits for a natural cold window (TTL
  // expiry, session resume) unless the evicted bytes clearly outweigh the
  // re-read; a provider without a cache has nothing to protect. A deferred
  // growth is retried on the next round, and an already-applied set stays
  // applied — re-sending its placeholders is byte-stable with the prefix.
  const provider = compaction.model.provider;
  const modelName = compaction.model.model;
  const appliedEvicted =
    evictionShapes.get(prefixMemoryScope ?? DEFAULT_PREFIX_SCOPE) ?? 0;
  const planned = isCompacting
    ? {
        history: options.chatHistory,
        evicted: 0,
        newlyEvictedChars: 0,
        movingWindowChars: 0,
      }
    : evictOldToolResults({
        history: options.chatHistory,
        contextWindow: getModelContextLimit(compaction.model),
        measuredInputTokens: measuredRequestFor(promptCacheKey)?.promptTokens,
        appliedEvicted,
        allowGrowth: true,
      });
  let eviction = planned;
  if (!isCompacting && planned.evicted > appliedEvicted) {
    const noCache = !Number.isFinite(cacheGapMs(provider, modelName));
    const cold = noCache || isCacheCold(Date.now(), provider, modelName);
    if (!cold) {
      const discount = cacheReadDiscountRatio(modelName) ?? 0.1;
      const worthIt = shouldApplyWarmEviction({
        newlyEvictedTokens: Math.ceil(planned.newlyEvictedChars / 4),
        movingWindowTokens: Math.ceil(planned.movingWindowChars / 4),
        cacheReadDiscount: discount,
      });
      logger.info("Warm-cache eviction gate", {
        appliedEvicted,
        plannedEvicted: planned.evicted,
        newlyEvictedTokens: Math.ceil(planned.newlyEvictedChars / 4),
        movingWindowTokens: Math.ceil(planned.movingWindowChars / 4),
        discount,
        worthIt,
      });
      if (!worthIt) {
        eviction = evictOldToolResults({
          history: options.chatHistory,
          contextWindow: getModelContextLimit(compaction.model),
          measuredInputTokens: measuredRequestFor(promptCacheKey)?.promptTokens,
          appliedEvicted,
          allowGrowth: false,
        });
      }
    }
  }
  if (eviction.evicted > appliedEvicted) {
    logger.info("Evicted old tool results from the request history", {
      evicted: eviction.evicted,
      newlyEvicted: eviction.evicted - appliedEvicted,
      keepRecentEnv: process.env.TNT_TOOL_EVICTION_KEEP,
    });
  }

  const preCompactionResult = await handlePreApiCompaction(eviction.history, {
    model: compaction.model,
    llmApi: compaction.llmApi,
    isCompacting,
    isHeadless: compaction.isHeadless,
    callbacks: compaction.callbacks,
    systemMessage: compaction.systemMessage,
    tools: compaction.tools,
    force: forceCompaction,
  });

  // Compared against the last request this session sent, not only against the
  // previous iteration: a prefix that moved between turns is the case that
  // costs the most and is otherwise invisible. A compaction request carries a
  // summary prompt of its own, so it neither reports on nor overwrites the
  // session prefix.
  const previousHeader = isCompacting
    ? undefined
    : recallCachePrefix(prefixMemoryScope);
  const verdict = isCompacting
    ? undefined
    : classifyCachePrefix(previousHeader, requestHeader, { historyRewritten });
  const finalVerdict = isCompacting
    ? undefined
    : withEvictionAttribution(prefixMemoryScope, eviction.evicted, verdict);

  if (finalVerdict?.state === "invalidated") {
    // Named fields rather than a hash: knowing that the tool list moved is
    // actionable, knowing that "something changed" is not.
    logger.warn("Request prefix invalidated", {
      reasons: finalVerdict.reasons,
      ...cachePrefixKeys(requestHeader),
      scenario: coldTurn ? "turn_start" : "mid_turn",
    });
  }
  if (!isCompacting) {
    rememberCachePrefix(prefixMemoryScope, requestHeader);
  }

  return {
    chatHistory: preCompactionResult.chatHistory,
    compacted: preCompactionResult.wasCompacted,
    summarized: preCompactionResult.summarized,
    reductionRatio: preCompactionResult.reductionRatio,
    previousHeader,
    verdict: finalVerdict,
  };
}

const TOOL_EVICTION_REASON = "tool_eviction";

/** Same fallback prefixState uses for a request with no session yet. */
const DEFAULT_PREFIX_SCOPE = "__session__";

/** Per-scope count of tool results the last request carried as placeholders. */
const evictionShapes = new Map<string, number>();

/**
 * A growing evicted set means this round's bytes diverge from the cached
 * prefix at the first newly swallowed position, which no header field records
 * and which would otherwise read as an unexplained full-price round. Folding
 * it into the verdict keeps the cache-break report honest. A stable set
 * re-sends the same placeholder bytes, which is a genuine full hit.
 */
function withEvictionAttribution(
  scope: string | undefined,
  evicted: number,
  verdict: CachePrefixVerdict | undefined,
): CachePrefixVerdict | undefined {
  const key = scope ?? DEFAULT_PREFIX_SCOPE;
  const remembered = evictionShapes.get(key);
  evictionShapes.set(key, evicted);
  if (evicted <= (remembered ?? 0)) {
    return verdict;
  }
  return {
    state: "invalidated",
    reasons: [...(verdict?.reasons ?? []), TOOL_EVICTION_REASON],
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
  /** Environment text that rides in the first user message, not the system field. */
  environmentContext?: string;
  tools?: ChatCompletionTool[];
}): { chatHistory: ChatHistoryItem[]; maxTokens?: number } {
  const {
    model,
    systemMessage,
    systemMessageUpdates,
    environmentContext,
    tools,
  } = options;
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
    (sum, content) => sum + encode(formatInHistoryUpdate(content)).length + 5,
    0,
  );
  const environmentTokens = environmentContext
    ? encode(environmentContext).length + 4
    : 0;
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

  const fixedTokens =
    systemTokens + updateTokens + environmentTokens + toolTokens;
  let historyCount = historyTokens;
  let validation = totalWith(historyCount + fixedTokens);
  while (history.length > 1 && !validation.isValid) {
    const prunedChatHistory = pruneLastMessage(history);
    if (prunedChatHistory.length === history.length) {
      break;
    }
    // A prune may drop two messages (a prompt whose reply would be left
    // dangling), so sum the removed tail's counts, not just the last item.
    for (let i = prunedChatHistory.length; i < history.length; i++) {
      historyCount -= itemTokens[i] ?? 0;
    }
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
