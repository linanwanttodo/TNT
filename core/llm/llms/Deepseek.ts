import { LLMOptions } from "../../index.js";
import { LlmApiRequestType } from "../openaiTypeConverters.js";
import { osModelsEditPrompt } from "../templates/edit.js";

import OpenAI from "./OpenAI.js";

/**
 * DeepSeek has two request paths of its own: a chat path whose reasoning
 * models report their chain of thought in `reasoning_content`, and the beta
 * fill-in-the-middle endpoint (`POST /beta/completions`). Both are owned by
 * the OpenAI adapter's DeepSeek implementation
 * (`packages/openai-adapters/src/apis/DeepSeek.ts`); this class only declares
 * the provider's registry identity, defaults and the capabilities the request
 * builder reads, so adding or changing request behavior does not fork
 * between two layers.
 */
class Deepseek extends OpenAI {
  static providerName = "deepseek";
  protected supportsReasoningField = false;
  protected supportsReasoningDetailsField = false;
  protected supportsReasoningContentField = true;

  // DeepSeek accepts a reasoning effort for its reasoning models.
  protected supportsReasoningEffort(_model?: string): boolean {
    return true;
  }
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://api.deepseek.com/",
    model: "deepseek-coder",
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
  };
  maxStopWords: number | undefined = 16;

  // The class builds no request of its own, so every path it supports - chat,
  // fill-in-the-middle, embeddings - is the adapter's to make.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = ["*"];

  supportsFim(): boolean {
    return true;
  }
}

export default Deepseek;
