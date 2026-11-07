import { ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";

import { compactChatHistory } from "./index.js";

export interface ManualCompactionResult {
  compactionIndex: number;
  /** Length of the history the caller's commit callback installed. */
  historyLength: number;
}

/**
 * Compact one history through the engine summarizer and hand the result to
 * the caller's commit callback.
 *
 * Every surface has a `/compact` (or a compact button) and each one reports it
 * differently - a terminal line, a JSON record, an SSE notice - so this keeps
 * the work and leaves the printing out. `commit` is how the caller installs
 * the compacted history: the service on the CLI paths, a direct write where
 * there is no service yet.
 */
export async function compactHistoryOnce(
  history: ChatHistoryItem[],
  model: ModelConfig,
  llmApi: BaseLlmApi,
  commit: (compacted: ChatHistoryItem[], compactionIndex: number) => void,
): Promise<ManualCompactionResult> {
  const result = await compactChatHistory(history, model, llmApi, {
    summarize: async (request) => {
      const { summarizeWithEngine } =
        await import("../stream/summarizeWithEngine.js");
      return summarizeWithEngine(request);
    },
  });

  commit(result.compactedHistory, result.compactionIndex);
  return {
    compactionIndex: result.compactionIndex,
    historyLength: result.compactedHistory.length,
  };
}
