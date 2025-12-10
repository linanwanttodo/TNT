import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi, constructLlmApi, LLMConfig } from "@tnt/openai-adapters";
import { Configuration, DefaultApi } from "@tnt/sdk/dist/api/dist/index.js";

import { AuthConfig } from "../auth/workos.js";
import { t } from "../i18n/index.js";
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
 * Creates an LLM API instance from a ModelConfig and auth configuration
 */
export function createLlmApi(
  model: ModelConfig,
  _authConfig: AuthConfig,
): BaseLlmApi | null {
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

export function getLlmApi(
  assistant: AssistantUnrolled,
  authConfig: AuthConfig,
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

  const llmApi = createLlmApi(model, authConfig);

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
