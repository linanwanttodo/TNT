import { LLMOptions } from "../..";
import { LLMConfigurationStatuses } from "../constants";
import { LlmApiRequestType } from "../openaiTypeConverters";

import OpenAI from "./OpenAI";

/**
 * Relace is an apply-only provider. All request building, streaming and
 * prediction handling is owned by the OpenAI adapter's Relace implementation
 * (`packages/openai-adapters/src/apis/Relace.ts`); this class only declares
 * the provider's registry identity and defaults, so adding or changing
 * request behavior does not fork between two layers.
 */
export class Relace extends OpenAI {
  static providerName = "relace";
  static defaultOptions: Partial<LLMOptions> | undefined = {
    apiBase: "https://instantapply.endpoint.relace.run/v1/",
  };
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = ["*"];

  protected supportsPrediction(model: string): boolean {
    return true;
  }

  getConfigurationStatus() {
    if (!this.apiKey) {
      return LLMConfigurationStatuses.MISSING_API_KEY;
    }

    return LLMConfigurationStatuses.VALID;
  }
}
