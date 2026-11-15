import { describe, expect, it } from "vitest";

import { LLMClasses } from "./index.js";
import Deepseek from "./Deepseek.js";

describe("Deepseek", () => {
  it("is the class LLMClasses resolves for the deepseek provider", () => {
    const cls = LLMClasses.find((llm) => llm.providerName === "deepseek");
    expect(cls).toBe(Deepseek);
  });

  it("owns no request logic of its own: every request path goes through the OpenAI adapter", () => {
    const llm = new Deepseek({ model: "deepseek-coder", apiKey: "anything" });

    // The class declares its own adapter-delegation set rather than reusing
    // OpenAI's split - a request path missing from this marker would fall
    // back to the legacy promise implementation, which is what the shell
    // guards against.
    expect(llm["useOpenAIAdapterFor"]).toEqual(["*"]);
  });

  it("keeps the reasoning flags the chat path needs", () => {
    const llm = new Deepseek({ model: "deepseek-coder", apiKey: "anything" });

    // DeepSeek reports the chain of thought in `reasoning_content` and takes
    // an effort level on the same request; without these flags the request
    // builder drops one and the other.
    expect(llm["supportsReasoningContentField"]).toBe(true);
    expect(
      (
        llm["supportsReasoningEffort" as keyof Deepseek] as (
          model?: string,
        ) => boolean
      ).call(llm, "deepseek-coder"),
    ).toBe(true);
  });

  it("keeps the fill-in-the-middle capability the adapter implements", () => {
    const llm = new Deepseek({ model: "deepseek-coder", apiKey: "anything" });

    // The adapter posts to the beta completions endpoint; the shell only
    // advertises that the provider can do it.
    expect(llm.supportsFim()).toBe(true);
  });
});
