import type { ModelConfig } from "@tnt/config-yaml";
import type { BaseLlmApi } from "@tnt/openai-adapters";

import type { SummarizeHistory } from "../compaction/index.js";
import { services } from "../services/index.js";
import { ModelService } from "../services/ModelService.js";

import { streamChatResponse } from "./streamChatResponse.js";

/**
 * The one place where compaction meets the engine.
 *
 * Compaction used to import this module, and this module imported compaction, so
 * neither could be loaded or tested without the other. The call is handed down
 * from here instead, which is the direction the layers actually run in: the
 * engine knows what a summary request costs, the summarization policy does not.
 */

/**
 * The model a summary call runs on. A config entry marked
 * `roles: ["summarize"]` is a deliberate routing decision - summaries are the
 * low-risk, high-token calls of this engine, so an operator can point them at a
 * cheaper model. The caller's own model stays the fallback when nothing is
 * marked, and the marked entry is skipped when it is the caller's model itself,
 * which would only build a second engine for the same request path.
 */
function resolveSummarizerEngine(requestModel: ModelConfig):
  | {
      model: ModelConfig;
      llmApi: BaseLlmApi;
    }
  | undefined {
  let match: ReturnType<typeof ModelService.findModelByRole> = null;
  try {
    match = ModelService.findModelByRole(
      services.model.getState(),
      "summarize",
    );
  } catch {
    // An uninitialized model service has nothing to route to; the caller's
    // model answers, as it always has.
    return undefined;
  }
  if (!match || !match.model || !match.llmApi) {
    return undefined;
  }
  const marked = match.model.name ?? match.model.model;
  const current = requestModel.name ?? requestModel.model;
  if (marked === current) {
    return undefined;
  }
  return { model: match.model, llmApi: match.llmApi };
}

export const summarizeWithEngine: SummarizeHistory = async (request) => {
  const summarizer = resolveSummarizerEngine(request.model);
  const response = await streamChatResponse(
    request.history,
    summarizer?.model ?? request.model,
    summarizer?.llmApi ?? request.llmApi,
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
