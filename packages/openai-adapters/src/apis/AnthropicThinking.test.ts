import { describe, expect, it } from "vitest";

import { anthropicThinkingConfig } from "./Anthropic.js";

describe("anthropicThinkingConfig", () => {
  it("returns no thinking config without reasoning fields", () => {
    expect(
      anthropicThinkingConfig({
        model: "claude-sonnet-4-6",
        messages: [],
        max_tokens: 32000,
      } as any),
    ).toEqual({});
  });

  it("maps an effort level to a budget scaled to the depth", () => {
    const { thinking } = anthropicThinkingConfig({
      model: "claude-sonnet-4-6",
      messages: [],
      max_tokens: 32000,
      reasoning_effort: "high",
    } as any);
    expect(thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
  });

  it("clamps the budget so the answer keeps room under max_tokens", () => {
    const { thinking } = anthropicThinkingConfig({
      model: "claude-sonnet-4-6",
      messages: [],
      max_tokens: 4096,
      reasoning_effort: "max",
    } as any);
    expect(thinking).toEqual({ type: "enabled", budget_tokens: 3072 });
  });

  it("never asks for less than the 1024-token minimum", () => {
    const { thinking } = anthropicThinkingConfig({
      model: "claude-sonnet-4-6",
      messages: [],
      max_tokens: 1024,
      reasoning_effort: "minimal",
    } as any);
    expect(thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("respects an explicit reasoning_budget_tokens from the config", () => {
    const { thinking } = anthropicThinkingConfig({
      model: "claude-sonnet-4-6",
      messages: [],
      max_tokens: 64000,
      reasoning_effort: "low",
      reasoning_budget_tokens: 32000,
    } as any);
    expect(thinking).toEqual({ type: "enabled", budget_tokens: 32000 });
  });

  it("drops the config when reasoning is off", () => {
    expect(
      anthropicThinkingConfig({
        model: "claude-sonnet-4-6",
        messages: [],
        max_tokens: 32000,
        reasoning: false,
        reasoning_effort: "high",
      } as any),
    ).toEqual({});
  });
});
