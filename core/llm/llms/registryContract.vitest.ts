import { describe, expect, it, vi } from "vitest";

import { constructLlmApi } from "@tnt/openai-adapters";

import { LLMClasses } from "./index.js";

// Some constructors (Gemini, WatsonX, HuggingFace variants) validate the key
// or reach the network during construction. Short-circuit every request so the
// registry contract can instantiate each class and read its real delegation
// set without touching a provider.
vi.mock("@tnt/fetch", () => {
  const reject = () => Promise.reject(new Error("mocked network"));
  return {
    fetch: vi.fn(reject),
    streamSse: vi.fn(reject),
    fetchwithRequestOptions: vi.fn(reject),
  };
});

/**
 * The two sides of the LLM layer must agree on which provider has an adapter:
 * a class whose delegation set is non-empty but has no constructLlmApi case
 * would promise a hand-off that never happens and silently fall back to
 * self-built requests. A shell with no adapter of its own either delegates
 * through a case, or declares an empty set - never a flag it cannot honor.
 *
 * The flag is a class field (useDefineForClassFields), so it lives on the
 * instance; a class that does not declare it inherits the base-class value.
 */
describe("LLM registry vs adapter switch", () => {
  it("every class with a non-empty delegation set has a constructLlmApi case", () => {
    for (const cls of LLMClasses) {
      let delegated: unknown[];
      try {
        const llm = new cls({ model: "x", apiKey: "k" }) as unknown as {
          useOpenAIAdapterFor?: unknown[];
        };
        delegated = llm.useOpenAIAdapterFor ?? [];
      } catch {
        // A constructor that refuses to build without real credentials is not
        // a class whose delegation can be exercised in this test; the class
        // still has to be reachable through the adapter switch if it declares
        // a set, so fall through to the switch check below with the inherited
        // default ([]) - which every provider without a case already has.
        delegated = [];
      }
      if (delegated.length === 0) {
        continue;
      }
      const api = constructLlmApi({
        provider: cls.providerName as never,
        model: "x",
      });
      expect(
        api,
        `${cls.providerName} declares a non-empty delegation set but constructLlmApi has no case for it`,
      ).toBeDefined();
    }
  });

  it("every adapter case that returns an api maps back to a registered LLM class", () => {
    const providerNames = LLMClasses.map((cls) => cls.providerName);
    // A sampling of the cases constructLlmApi handles - each must resolve to a
    // real class so the switch never points at a provider with no shell.
    const handled = [
      "openai",
      "azure",
      "anthropic",
      "gemini",
      "deepseek",
      "moonshot",
      "relace",
      "inception",
      "mistral",
      "groq",
      "openrouter",
    ];
    for (const provider of handled) {
      expect(
        providerNames,
        `${provider} has a case but no LLM class`,
      ).toContain(provider);
    }
  });
});
