import type { SummarizeHistory } from "../compaction/index.js";

import { streamChatResponse } from "./streamChatResponse.js";

/**
 * The one place where compaction meets the engine.
 *
 * Compaction used to import this module, and this module imported compaction, so
 * neither could be loaded or tested without the other. The call is handed down
 * from here instead, which is the direction the layers actually run in: the
 * engine knows what a summary request costs, the summarization policy does not.
 */
export const summarizeWithEngine: SummarizeHistory = async (request) => {
  const response = await streamChatResponse(
    request.history,
    request.model,
    request.llmApi,
    request.abortController,
    {
      onContent: request.callbacks.onContent,
      onContentComplete: request.callbacks.onContentComplete,
    },
    true,
  );

  // The streamed text has already arrived through the callbacks; a provider that
  // answers in one piece instead is covered by the returned value.
  return typeof response === "string" ? response : "";
};
