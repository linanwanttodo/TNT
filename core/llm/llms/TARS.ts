import { LLMOptions } from "../../index.js";
import { LlmApiRequestType } from "../openaiTypeConverters.js";
import { osModelsEditPrompt } from "../templates/edit.js";

import OpenAI from "./OpenAI.js";

class TARS extends OpenAI {
  static providerName = "tars";
  // No constructLlmApi adapter exists for this provider, so the base class's
  // delegation flag would promise a hand-off that never happens and silently
  // fall back to self-built requests. Declare the truth instead.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [];
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.router.tetrate.ai/v1",
    model: "gpt-5-mini",
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
  };
}

export default TARS;
