import { ModelConfig } from "@tnt/config-yaml";
import type { ChatHistoryItem } from "core/index.js";
import { useEffect, useMemo, useState } from "react";

import { currentPromptCacheKey } from "../../cache/promptCacheKey.js";
import { measuredRequestFor } from "../../compaction/measuredContext.js";
import { getModelContextLimit } from "../../utils/tokenizer.js";
import { contextUsage, type ContextUsage } from "../utils/contextReadout.js";

interface UseContextPercentageProps {
  chatHistory: ChatHistoryItem[];
  model?: ModelConfig;
}

/**
 * The context readout, measured the way pi measures it: the provider's own
 * prompt-token count for the last request, divided by the model's context
 * window. A local re-count of the history is neither measured nor cheap, and
 * it is the number that decides when the session compacts - so the screen and
 * the trigger must agree.
 *
 * Before the first request of a session there is no measured number, and the
 * readout says so rather than inventing one.
 */
export function useContextPercentage({
  chatHistory,
  model,
}: UseContextPercentageProps) {
  const [, setRevision] = useState(0);

  // The measurement arrives with the response; the chat history is what
  // changes when it lands, so the history is the signal to re-read it.
  const measured = useMemo(() => {
    if (!model) return undefined;
    return measuredRequestFor(currentPromptCacheKey())?.promptTokens;
  }, [chatHistory, model]);

  useEffect(() => {
    setRevision((revision) => revision + 1);
  }, [chatHistory, model]);

  const contextData = useMemo(() => {
    if (!model) {
      return null;
    }
    const limit = getModelContextLimit(model);
    const usage: ContextUsage = contextUsage(measured, limit);
    return {
      tokenCount: usage.tokens,
      percentage: usage.percent,
      contextWindow: usage.contextWindow,
    };
  }, [measured, model]);

  return contextData;
}
