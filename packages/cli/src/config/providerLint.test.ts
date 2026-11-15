import { describe, expect, it } from "vitest";

import {
  assertModelChoices,
  lintConfiguredModels,
  lintModelChoice,
} from "./providerLint.js";

/**
 * A Claude model under an OpenAI provider fails at the provider, with a message
 * about a field the user never wrote, after the session has already started. The
 * names make the mistake visible before the first request; this is what makes it
 * visible.
 */
describe("model and provider that cannot answer each other", () => {
  it("names a Claude model sent to an OpenAI-shaped provider", () => {
    const mismatch = lintModelChoice("openai", "claude-sonnet-4-5");

    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain('Model "claude-sonnet-4-5"');
    expect(mismatch!.message).toContain("provider: openai");
    expect(mismatch!.message).toContain("Anthropic Messages API");
    expect(mismatch!.message).toContain("refused by the provider");
  });

  it("names an OpenAI-shaped model sent to Anthropic", () => {
    const mismatch = lintModelChoice("anthropic", "gpt-4o");

    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain("provider: anthropic");
    expect(mismatch!.message).toContain("answers only Claude models");
  });

  it("accepts the pairs that belong together", () => {
    expect(lintModelChoice("anthropic", "claude-sonnet-4-5")).toBeUndefined();
    expect(lintModelChoice("openai", "gpt-4o")).toBeUndefined();
    expect(lintModelChoice("openai", "o3-mini")).toBeUndefined();
    expect(lintModelChoice("deepseek", "deepseek-chat")).toBeUndefined();
    // A gateway name this reader has never seen is not a verdict.
    expect(lintModelChoice("my-gateway", "claude-sonnet-4-5")).toBeUndefined();
    expect(lintModelChoice("my-gateway", "gpt-4o")).toBeUndefined();
  });

  it("fires on single-family providers and stays quiet on gateways", () => {
    expect(lintModelChoice("deepseek", "claude-3-5-sonnet")).toBeDefined();
    expect(lintModelChoice("groq", "claude-sonnet-4-5")).toBeDefined();
    // OpenRouter, Azure AI Foundry and a local runner can serve either family,
    // so a pair through them is not this reader's verdict to make.
    expect(lintModelChoice("openrouter", "claude-sonnet-4-5")).toBeUndefined();
    expect(lintModelChoice("azure", "claude-opus-4-5")).toBeUndefined();
    expect(lintModelChoice("ollama", "claude-3-5-sonnet")).toBeUndefined();
    expect(lintModelChoice("bedrock-anthropic", "gpt-4o-mini")).toBeUndefined();
  });

  it("says nothing about entries that name neither a provider nor a model", () => {
    expect(lintModelChoice(undefined, "claude-sonnet-4-5")).toBeUndefined();
    expect(lintModelChoice("openai", undefined)).toBeUndefined();
    expect(lintConfiguredModels(undefined)).toEqual([]);
  });

  it("reports every offending pair at once, because a config is fixed in one edit", () => {
    const mismatches = lintConfiguredModels([
      { provider: "openai", model: "claude-sonnet-4-5" },
      { provider: "openai", model: "gpt-4o" },
      { provider: "anthropic", model: "gpt-4o" },
    ]);

    expect(mismatches).toHaveLength(2);

    let raised: Error | undefined;
    try {
      assertModelChoices([
        { provider: "openai", model: "claude-sonnet-4-5" },
        { provider: "anthropic", model: "gpt-4o" },
      ]);
    } catch (error) {
      raised = error as Error;
    }

    expect(raised).toBeDefined();
    expect(raised!.message.split("\n")).toHaveLength(2);
  });

  it("lets a healthy config through", () => {
    expect(() =>
      assertModelChoices([
        { provider: "openai", model: "gpt-4o" },
        { provider: "anthropic", model: "claude-sonnet-4-5" },
      ]),
    ).not.toThrow();
  });
});
