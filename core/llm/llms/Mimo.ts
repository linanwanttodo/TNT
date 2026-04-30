import { LLMOptions } from "../../index.js";
import { LlmApiRequestType } from "../openaiTypeConverters.js";
import OpenAI from "./OpenAI.js";

class Mimo extends OpenAI {
  static providerName = "mimo";
  // No constructLlmApi adapter exists for this provider, so the base class's
  // delegation flag would promise a hand-off that never happens and silently
  // fall back to self-built requests. Declare the truth instead.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [];
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.xiaomimimo.com/v1/",
    model: "mimo-v2-flash",
  };
}

export default Mimo;
