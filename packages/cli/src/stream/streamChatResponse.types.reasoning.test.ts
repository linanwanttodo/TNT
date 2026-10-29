import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getReasoningOverride,
  setReasoningOverride,
  type ReasoningDepth,
} from "../session/reasoningOverride.js";

import { getDefaultCompletionOptions } from "./streamChatResponse.types.js";

describe("getDefaultCompletionOptions reasoning passthrough", () => {
  beforeEach(() => {
    setReasoningOverride(null);
  });

  afterEach(() => {
    setReasoningOverride(null);
    vi.unstubAllEnvs();
  });

  it("carries the model's configured reasoning fields", () => {
    const options = getDefaultCompletionOptions({
      reasoning: true,
      reasoningEffort: "high",
      reasoningBudgetTokens: 4096,
    }) as Record<string, unknown>;
    expect(options as Record<string, unknown>).toMatchObject({
      reasoning: true,
      reasoning_effort: "high",
      reasoning_budget_tokens: 4096,
    });
  });

  it("omits reasoning fields the model config does not set", () => {
    const options = getDefaultCompletionOptions({});
    expect(options as Record<string, unknown>).not.toHaveProperty("reasoning");
    expect(options as Record<string, unknown>).not.toHaveProperty(
      "reasoning_effort",
    );
    expect(options as Record<string, unknown>).not.toHaveProperty(
      "reasoning_budget_tokens",
    );
  });

  it("a session override wins over the model config", () => {
    setReasoningOverride("low");
    const options = getDefaultCompletionOptions({
      reasoningEffort: "high",
    });
    expect(options.reasoning_effort).toBe("low");
    expect((options as Record<string, unknown>).reasoning).toBe(true);
  });

  it("off disables reasoning and drops the effort", () => {
    setReasoningOverride("off");
    const options = getDefaultCompletionOptions({
      reasoning: true,
      reasoningEffort: "high",
    });
    expect((options as Record<string, unknown>).reasoning).toBe(false);
    expect(options as Record<string, unknown>).not.toHaveProperty(
      "reasoning_effort",
    );
  });

  it("default falls back to the model config", () => {
    setReasoningOverride("default");
    const options = getDefaultCompletionOptions({
      reasoning: true,
      reasoningEffort: "medium",
    });
    expect((options as Record<string, unknown>).reasoning).toBe(true);
    expect(options.reasoning_effort).toBe("medium");
  });

  it("restores the persisted choice on the first request", async () => {
    vi.doMock("../config/settingsFiles.js", () => ({
      readSettingsString: () => "high",
    }));
    // restoreReasoningOverride runs inside getDefaultCompletionOptions; a fresh
    // module graph picks up the mocked settings reader.
    vi.resetModules();
    const { getDefaultCompletionOptions: fresh } =
      await import("./streamChatResponse.types.js");
    const options = fresh({});
    expect(options.reasoning_effort).toBe("high");
    setReasoningOverride(null);
  });

  it("the override store round-trips through the parser", () => {
    const depths: ReasoningDepth[] = [
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "default",
    ];
    for (const depth of depths) {
      setReasoningOverride(depth);
      expect(getReasoningOverride()).toBe(depth);
    }
  });
});
