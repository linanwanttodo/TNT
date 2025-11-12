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

  it("sends the install correlation id", () => {
    const api: any = createLlmApi(model, {} as any);
    expect(api.config.requestOptions.headers["x-tnt-unique-id"]).toBe(
      getUniqueId(),
    );
  });

  it("does not send a CLI user-agent over the SDK's own", () => {
    const api: any = createLlmApi(model, {} as any);
    expect(api.config.requestOptions.headers).not.toHaveProperty("user-agent");
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
