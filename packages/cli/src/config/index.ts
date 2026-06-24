import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import {
  BaseLlmApi,
  constructLlmApi,
  fetchOllamaContextLength,
  LLMConfig,
} from "@tnt/openai-adapters";
import { Configuration, DefaultApi } from "@tnt/sdk/dist/api/dist/index.js";

import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";
import { getUniqueId } from "../utils/uniqueId.js";

import { env } from "./env.js";
import { assertModelChoices } from "./providerLint.js";

/**
 * Adds the header that lets a support request tie provider-side logs back to one install.
 *
 * Only this header is sent. The SDK clients already put their own transport identity in
 * `User-Agent` (`OpenAI/JS <version>`, `Anthropic/JS <version>`) and merge per-request headers
 * last, so a CLI-authored `user-agent` would have replaced the value vendors key rate limits
 * and support triage on rather than adding to it; the earlier helper that built one was never
 * called, and is gone rather than wired.
 */
function withCorrelationHeader(
  requestOptions: ModelConfig["requestOptions"],
): ModelConfig["requestOptions"] {
  return {
    ...requestOptions,
    headers: {
      ...requestOptions?.headers,
      "x-tnt-unique-id": getUniqueId(),
    },
  };
}

/**
 * Creates an LLM API instance from a ModelConfig
 */
export function createLlmApi(model: ModelConfig): BaseLlmApi | null {
  const config: LLMConfig = {
    provider: model.provider as any,
    model: model.model,
    apiKey: model.apiKey,
    apiBase: model.apiBase,
    requestOptions: withCorrelationHeader(model.requestOptions),
    env: model.env,
  };

  return constructLlmApi(config) ?? null;
}

/**
 * Fills an ollama model's context window from the server itself, so the
 * context budgeting reads the window the model actually runs with instead of
 * the 200k generic default. Only ollama models without an explicit window are
 * probed; anything the server does not answer comes back unchanged and the
 * tokenizer's 8192 floor applies.
 */
export async function applyOllamaContextWindow(
  model: ModelConfig,
): Promise<ModelConfig> {
  if (model.provider !== "ollama") {
    return model;
  }
  if (
    model.contextLength !== undefined ||
    model.defaultCompletionOptions?.contextLength !== undefined
  ) {
    return model;
  }

  const discovered = await fetchOllamaContextLength(model.apiBase, model.model);
  if (discovered === null) {
    logger.warn(
      "Could not read the Ollama context window from /api/show; falling back to 8192",
      { model: model.model, apiBase: model.apiBase },
    );
    return model;
  }

  // Mutated in place on purpose: the same object sits in the service state and
  // the available-models list, and every consumer must see the one window.
  model.contextLength = discovered;
  logger.info("Discovered the Ollama context window", {
    model: model.model,
    contextLength: discovered,
  });
  return model;
}

export function getLlmApi(
  assistant: AssistantUnrolled,
): [BaseLlmApi, ModelConfig] {
  if (!assistant.models || assistant.models.length === 0) {
    throw new Error(t("config.noModels"));
  }

  const model = assistant.models?.find(
    (model) =>
      model?.roles?.includes("chat") || (model && model.roles === undefined),
  );

  if (!model) {
    throw new Error(t("config.noChatModels"));
  }

  // The last gate before a request exists: a model the provider cannot answer
  // fails at the provider with a message about a field the user never wrote.
  assertModelChoices([model]);

  const llmApi = createLlmApi(model);

  if (!llmApi) {
    throw new Error(t("config.llmInitFailed"));
  }

  return [llmApi, model];
}

export function getApiClient(
  accessToken: string | undefined | null,
): DefaultApi {
  return new DefaultApi(
    new Configuration({
      basePath: env.apiBase.replace(/\/$/, ""),
      accessToken: accessToken ?? undefined,
    }),
  );
}
