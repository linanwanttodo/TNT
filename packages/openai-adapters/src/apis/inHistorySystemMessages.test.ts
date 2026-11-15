import { describe, expect, it } from "vitest";

import type { BaseLlmApi } from "./base.js";

import { AnthropicApi } from "./Anthropic.js";
import { CohereApi } from "./Cohere.js";
import { OpenAIApi } from "./OpenAI.js";

describe("carriesInHistorySystemMessages", () => {
  const openai = new OpenAIApi({
    provider: "openai",
    name: "test",
    apiKey: "test",
    apiBase: "https://api.openai.com/v1/",
    model: "gpt-4o",
  } as any);

  it("declares the chat body it forwards verbatim", () => {
    expect(openai.carriesInHistorySystemMessages("gpt-4o")).toBe(true);

    // A gateway never takes the Responses route, so the same body applies.
    const gateway = new OpenAIApi({
      provider: "openai",
      name: "test",
      apiKey: "test",
      apiBase: "https://gateway.example/v1/",
      model: "gpt-5",
    } as any);
    expect(gateway.carriesInHistorySystemMessages("gpt-5")).toBe(true);
  });

  it("refuses the route whose body it has not read", () => {
    // The official endpoint sends responses-shaped models through a different
    // body builder, so "the chat body forwards messages" says nothing about them.
    const openaiOnResponses = new OpenAIApi({
      provider: "openai",
      name: "test",
      apiKey: "test",
      apiBase: "https://api.openai.com/v1/",
      model: "gpt-5",
    } as any);
    expect(openaiOnResponses.carriesInHistorySystemMessages("gpt-5")).toBe(
      false,
    );
  });

  /** Read through the interface, where the member is optional. */
  const declared = (api: BaseLlmApi) => api.carriesInHistorySystemMessages;

  it("stays silent for a dialect that lifts one system message out", () => {
    const anthropic = new AnthropicApi({
      provider: "anthropic",
      name: "test",
      apiKey: "test",
      model: "claude-sonnet-4-5",
    } as any);
    const cohere = new CohereApi({
      provider: "cohere",
      name: "test",
      apiKey: "test",
      model: "command-r",
    } as any);

    expect(declared(anthropic)).toBeUndefined();
    expect(declared(cohere)).toBeUndefined();
  });
});
