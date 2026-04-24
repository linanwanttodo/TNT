import { describe, expect, it } from "vitest";

import { LLMClasses } from "./index.js";
import zAI from "./zAI.js";

describe("zAI", () => {
  it("is the class LLMClasses resolves for the zAI provider", () => {
    const cls = LLMClasses.find((llm) => llm.providerName === "zAI");
    expect(cls).toBe(zAI);
  });

  it("owns no request logic of its own: every request path goes through the OpenAI adapter", () => {
    const llm = new zAI({ model: "glm-5", apiKey: "anything" });

    // The class declares its own adapter-delegation set rather than reusing
    // OpenAI's split - a request path missing from this marker would fall
    // back to the legacy promise implementation, which is what the shell
    // guards against.
    expect(llm["useOpenAIAdapterFor"]).toEqual(["*"]);
  });

  it("reads GLM's reasoning_content field only for the generations that think", () => {
    // GLM streams its chain of thought in delta.reasoning_content and expects
    // it back on the next turn; without this flag the request builder drops
    // the field and the reasoning never reaches the transcript.
    const thinking = new zAI({ model: "glm-5", apiKey: "anything" });
    expect(thinking["supportsReasoningContentField"]).toBe(true);

    const older = new zAI({ model: "glm-4-plus", apiKey: "anything" });
    expect(older["supportsReasoningContentField"]).toBe(false);
  });

  it("defaults to the paas v4 endpoint the docs name", () => {
    expect(zAI.defaultOptions?.apiBase).toBe("https://api.z.ai/api/paas/v4/");
  });
});
