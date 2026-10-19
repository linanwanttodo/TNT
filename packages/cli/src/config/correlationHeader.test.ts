import { describe, expect, it } from "vitest";

import { getUniqueId } from "../utils/uniqueId.js";

import { createLlmApi } from "./index.js";

/**
 * What a model request carries for identification, asserted where the client is actually built
 * rather than on a helper: the adapter keeps the `LLMConfig` it was constructed with, so this
 * is the same object the outbound fetch reads its headers from.
 */
describe("the CLI identifies a request without replacing the SDK identity", () => {
  const model: any = {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "test-key",
  };

  /**
   * The header is added before the factory dispatches, so it should reach every
   * dialect rather than the one the CLI happens to test against. These are the
   * providers whose client builds successfully here; a dialect that quietly drops
   * `requestOptions` would fail its own row.
   */
  const PROVIDERS = [
    "openai",
    "anthropic",
    "deepseek",
    "openrouter",
    "azure",
    "gemini",
    "bedrock",
    "ollama",
  ];

  it("sends the install correlation id on every provider dialect", () => {
    expect(PROVIDERS.length).toBeGreaterThan(4);
    for (const provider of PROVIDERS) {
      const api: any = createLlmApi({ ...model, provider }, {} as any);
      expect(api, provider).toBeTruthy();
      expect(
        api.config.requestOptions.headers["x-tnt-unique-id"],
        provider,
      ).toBe(getUniqueId());
    }
  });

  it("does not send a CLI user-agent over the SDK's own", () => {
    for (const provider of ["openai", "anthropic"]) {
      const api: any = createLlmApi({ ...model, provider }, {} as any);
      expect(api.config.requestOptions.headers, provider).not.toHaveProperty(
        "user-agent",
      );
    }
  });

  it("keeps headers the user configured", () => {
    const api: any = createLlmApi(
      { ...model, requestOptions: { headers: { "x-team": "platform" } } },
      {} as any,
    );
    expect(api.config.requestOptions.headers["x-team"]).toBe("platform");
    expect(api.config.requestOptions.headers["x-tnt-unique-id"]).toBeDefined();
  });
});
