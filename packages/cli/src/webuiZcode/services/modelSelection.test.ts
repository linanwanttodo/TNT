import { describe, expect, it } from "vitest";

import {
  buildModelSelectionView,
  createTntModelSelectionService,
  type TntModelSource,
} from "./modelSelection.js";

const SOURCE: TntModelSource = {
  models: [
    {
      name: "local-deepseek",
      provider: "openai",
      model: "auto/deepseek-v4.1-flash",
      apiBase: "http://127.0.0.1:3425/v1",
      contextLength: 200_000,
      maxOutputTokens: 64_000,
      roles: ["chat", "edit"],
    },
    {
      name: "claude",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      contextLength: 200_000,
      roles: ["chat"],
    },
    {
      name: "gemini",
      provider: "gemini",
      model: "gemini-2.5-pro",
      contextLength: 1_000_000,
      roles: ["chat"],
    },
  ],
  selected: "local-deepseek",
};

describe("buildModelSelectionView", () => {
  it("projects TNT models into provider groups with a real context window", () => {
    const view = buildModelSelectionView(SOURCE, 1);

    expect(view.revision).toBe(1);
    // The shell's draft initialization rejects a preferredSelection without a
    // reasoning level from the model's optionSpecs, so the adapter completes
    // it with the highest offered level, the same rule the reference host uses.
    expect(view.preferredSelection).toEqual({
      providerId: "openai",
      modelId: "local-deepseek",
      options: { reasoningLevel: "max" },
    });
    const openai = view.providers.find(
      (provider) => provider.providerId === "openai",
    );
    expect(openai?.models.map((model) => model.modelId)).toEqual([
      "local-deepseek",
    ]);
    expect(openai?.models[0]?.config.properties.contextWindow).toBe(200_000);
    expect(openai?.models[0]?.config.optionSpecs.reasoningLevel).toEqual({
      values: ["off", "low", "medium", "high", "xhigh", "max"],
      map: "{}",
    });
    expect(openai?.models[0]?.config.optionSpecs.maxOutputTokens.max).toBe(
      64_000,
    );
    expect(openai?.config.api).toEqual({
      type: "openai-chat-completions",
      baseUrl: "http://127.0.0.1:3425/v1",
    });
  });

  it("uses the protocol only when TNT speaks it", () => {
    const view = buildModelSelectionView(SOURCE, 1);
    const anthropic = view.providers.find(
      (provider) => provider.providerId === "anthropic",
    );
    const gemini = view.providers.find(
      (provider) => provider.providerId === "gemini",
    );

    expect(anthropic?.config.api).toEqual({ type: "anthropic-messages" });
    expect(gemini?.config.api).toBeUndefined();
  });

  it("reports a selection that names no configured model", () => {
    const view = buildModelSelectionView(SOURCE, 2, {
      selection: { providerId: "openai", modelId: "missing" },
    });

    expect(view.effectiveSelection).toBeNull();
    expect(view.selectionIssue).toBe("model-not-found");
  });

  it("returns the requested selection when it exists", () => {
    const view = buildModelSelectionView(SOURCE, 2, {
      selection: { providerId: "anthropic", modelId: "claude" },
    });

    expect(view.effectiveSelection).toEqual({
      providerId: "anthropic",
      modelId: "claude",
    });
    expect(view.selectionIssue).toBeUndefined();
  });

  it("falls back to the first chat model when no model is selected", () => {
    const view = buildModelSelectionView(
      { models: [{ ...SOURCE.models[2]!, roles: ["edit"] }] },
      1,
    );

    expect(view.preferredSelection).toEqual({
      providerId: "gemini",
      modelId: "gemini",
      options: { reasoningLevel: "max" },
    });
  });

  it("has no preferred selection for an empty config", () => {
    const view = buildModelSelectionView({ models: [] }, 1);

    expect(view.providers).toEqual([]);
    expect(view.preferredSelection).toBeUndefined();
  });
});

describe("createTntModelSelectionService", () => {
  it("reads the injected source and advances the revision", async () => {
    const service = createTntModelSelectionService(async () => SOURCE);

    const first = await service.getView();
    const second = await service.getView();

    expect(first.preferredSelection?.modelId).toBe("local-deepseek");
    expect(second.revision).toBeGreaterThan(first.revision);
  });
});
