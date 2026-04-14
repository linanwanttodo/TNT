import { describe, expect, it } from "vitest";

import { LLMClasses } from "./index.js";
import Moonshot from "./Moonshot.js";

describe("Moonshot", () => {
  it("is the class LLMClasses resolves for the moonshot provider", () => {
    const cls = LLMClasses.find((llm) => llm.providerName === "moonshot");
    expect(cls).toBe(Moonshot);
  });

  it("owns no request logic of its own: every request path goes through the OpenAI adapter", () => {
    const llm = new Moonshot({ model: "kimi-k2", apiKey: "anything" });

    // The class declares its own adapter-delegation set rather than reusing
    // OpenAI's split - a request path missing from this marker would fall
    // back to the legacy promise implementation, which is what the shell
    // guards against.
    expect(llm["useOpenAIAdapterFor"]).toEqual(["*"]);
  });

  it("reads reasoning_content only for kimi models", () => {
    // The kimi generations report their chain of thought in
    // `reasoning_content`; the older moonshot-v1 models do not.
    const kimi = new Moonshot({ model: "kimi-k2", apiKey: "anything" });
    expect(kimi["supportsReasoningContentField"]).toBe(true);

    const legacy = new Moonshot({
      model: "moonshot-v1-8k",
      apiKey: "anything",
    });
    expect(legacy["supportsReasoningContentField"]).toBe(false);
  });

  it("keeps the fill-in-the-middle capability the adapter implements", () => {
    const llm = new Moonshot({ model: "kimi-k2", apiKey: "anything" });

    // The adapter sends the [fill] prompt through chat completions; the
    // shell only advertises that the provider can do it.
    expect(llm.supportsFim()).toBe(true);
  });
});
