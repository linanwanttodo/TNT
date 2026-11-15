import { LLMOptions } from "../../index.js";
import { LlmApiRequestType } from "../openaiTypeConverters.js";
import { osModelsEditPrompt } from "../templates/edit.js";

import OpenAI from "./OpenAI.js";

/**
 * Kimi exposes an OpenAI-compatible chat endpoint, and reads
 * `prompt_cache_options` from K3 onward - both owned by the OpenAI adapter's
 * Moonshot implementation (`packages/openai-adapters/src/apis/Moonshot.ts`).
 * This class only declares the provider's registry identity, defaults and the
 * model-dependent capabilities the request builder reads, so adding or
 * changing request behavior does not fork between two layers.
 */
class Moonshot extends OpenAI {
  static providerName = "moonshot";

  constructor(options: LLMOptions) {
    super(options);
    this.supportsReasoningContentField =
      this.model?.startsWith("kimi") ?? false;
  }

  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.moonshot.cn/v1/",
    model: "moonshot-v1-8k",
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
  };
  maxStopWords: number | undefined = 16;

  // The class builds no request of its own, so every path it supports - chat,
  // fill-in-the-middle (sent as a chat completion), embeddings - is the
  // adapter's to make.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = ["*"];

  supportsFim(): boolean {
    return true;
  }
}

export default Moonshot;
