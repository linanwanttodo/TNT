import { ChatCompletionCreateParams } from "@tnt/openai-adapters";
import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js";
import { LlmApiRequestType } from "../openaiTypeConverters.js";

import OpenAI from "./OpenAI";

class Venice extends OpenAI {
  static providerName = "venice";
  // No constructLlmApi adapter exists for this provider, so the base class's
  // delegation flag would promise a hand-off that never happens and silently
  // fall back to self-built requests. Declare the truth instead.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [];
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.venice.ai/api/v1/",
  };

  protected _convertArgs(
    options: CompletionOptions,
    messages: ChatMessage[],
  ): ChatCompletionCreateParams {
    const finalOptions = super._convertArgs(
      options,
      messages,
    ) as ChatCompletionCreateParams & { venice_parameters?: any };
    if (
      "venice_parameters" in options &&
      typeof options.venice_parameters === "object"
    ) {
      finalOptions.venice_parameters = { ...options.venice_parameters };
    }
    return finalOptions;
  }
}

export default Venice;
