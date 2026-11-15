import { LLMOptions } from "../..";
import { LlmApiRequestType } from "../openaiTypeConverters.js";
import OpenAI from "./OpenAI";

class Nous extends OpenAI {
  static providerName = "nous";
  // No constructLlmApi adapter exists for this provider, so the base class's
  // delegation flag would promise a hand-off that never happens and silently
  // fall back to self-built requests. Declare the truth instead.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [];
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://inference-api.nousresearch.com/v1",
    useLegacyCompletionsEndpoint: false,
  };
}

export default Nous;
