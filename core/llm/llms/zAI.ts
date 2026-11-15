import { LLMOptions } from "../../index.js";
import { LlmApiRequestType } from "../openaiTypeConverters.js";

import OpenAI from "./OpenAI.js";

/** GLM-4.5 and up think by default and report their reasoning. */
const SUPPORTS_THINKING = /^glm-(4\.[5-9]|[5-9])/;

/**
 * Z.ai's GLM models speak the OpenAI chat protocol from
 * `https://api.z.ai/api/paas/v4/` - the adapter route is the generic
 * `openAICompatible` factory in `packages/openai-adapters/src/index.ts`,
 * with the prompt-cache facts for `glm` handled in `cachePolicy.ts`. This
 * class only declares the provider's registry identity and defaults, so
 * every request goes through the same OpenAI adapter the other
 * OpenAI-compatible providers share.
 *
 * GLM streams its chain of thought in `delta.reasoning_content` (the same
 * field DeepSeek uses), and expects that reasoning back when the next turn
 * continues from it - but only the generations that think at all. Thinking
 * mode arrived with GLM-4.5; the older GLM models have no such field, so
 * echoing one back to them would be a request they cannot read.
 */
class zAI extends OpenAI {
  static providerName = "zAI";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.z.ai/api/paas/v4/",
    useLegacyCompletionsEndpoint: false,
  };

  constructor(options: LLMOptions) {
    super(options);
    this.supportsReasoningContentField = SUPPORTS_THINKING.test(
      this.model ?? "",
    );
  }

  // The class builds no request of its own, so every path it supports is
  // the adapter's to make.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = ["*"];
}

export default zAI;
