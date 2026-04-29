import { LLMOptions } from "../../index.js";
import { LlmApiRequestType } from "../openaiTypeConverters.js";
import OpenAI from "./OpenAI.js";

class Lemonade extends OpenAI {
  static providerName = "lemonade";
  // No constructLlmApi adapter exists for this provider, so the base class's
  // delegation flag would promise a hand-off that never happens and silently
  // fall back to self-built requests. Declare the truth instead.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [];
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "http://localhost:8000/api/v1/",
  };
}

export default Lemonade;
