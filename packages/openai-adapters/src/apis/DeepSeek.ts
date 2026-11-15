import { streamSse } from "@tnt/fetch";
import { ChatCompletionChunk, Model } from "openai/resources/index";
import { DeepseekConfig } from "../types.js";
import { chatChunk, customFetch } from "../util.js";
import { OpenAIApi } from "./OpenAI.js";
import { FimCreateParamsStreaming } from "./base.js";

export const DEEPSEEK_API_BASE = "https://api.deepseek.com/";

/**
 * The beta fill-in-the-middle endpoint. The request is the OpenAI FIM
 * completion shape against `POST https://api.deepseek.com/beta/completions`:
 * https://api-docs.deepseek.com/api/create-completion/
 */
export class DeepSeekApi extends OpenAIApi {
  constructor(config: DeepseekConfig) {
    super({
      ...config,
      provider: "openai",
      apiBase: config.apiBase ?? DEEPSEEK_API_BASE,
    });
  }

  async *fimStream(
    body: FimCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk, any, unknown> {
    const endpoint = new URL("beta/completions", this.apiBase);
    const resp = await customFetch(this.config.requestOptions)(endpoint, {
      method: "POST",
      body: JSON.stringify({
        model: body.model,
        prompt: body.prompt,
        suffix: body.suffix,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
        top_p: body.top_p,
        stop: body.stop,
        stream: true,
      }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      signal,
    });
    for await (const chunk of streamSse(resp as any)) {
      yield chatChunk({
        content: chunk.choices[0].text,
        finish_reason: chunk.finish_reason,
        model: body.model,
      });
    }
  }

  list(): Promise<Model[]> {
    throw new Error("Method not implemented.");
  }
}
