import { describe, expect, it } from "vitest";

import { LLMClasses } from "./index.js";
import { Relace } from "./Relace.js";

describe("Relace", () => {
  it("is the class LLMClasses resolves for the relace provider", () => {
    const cls = LLMClasses.find((llm) => llm.providerName === "relace");
    expect(cls).toBe(Relace);
  });

  it("owns no request logic of its own: every request path goes through the OpenAI adapter", () => {
    const llm = new Relace({ model: "instant-apply", apiKey: "anything" });

    // The class declares its own adapter-delegation set rather than reusing
    // OpenAI's split - a request path missing from this marker would fall
    // back to the legacy promise implementation, which is what the shell
    // guards against.
    expect(llm["useOpenAIAdapterFor"]).toEqual(["*"]);
  });

  it("keeps the prediction flag the apply path needs", () => {
    const llm = new Relace({ model: "instant-apply", apiKey: "anything" });

    // RelaceApi's chatCompletionStream reads the prediction the request
    // carries; without this flag the shell silently loses the apply input.
    expect(
      llm["supportsPrediction" as keyof Relace].call(llm, "instant-apply"),
    ).toBe(true);
  });
});
