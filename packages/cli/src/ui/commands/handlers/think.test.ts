import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setReasoningOverride } from "../../../session/reasoningOverride.js";

vi.mock("../../../services/index.js", () => ({
  services: {
    model: {
      getState: () => ({
        model: {
          name: "test-model",
          model: "test-model",
          provider: "openai",
          defaultCompletionOptions: { reasoningEffort: "medium" },
        },
      }),
    },
  },
}));

const writeSettingsValue = vi.fn();
vi.mock("../../../config/settingsFiles.js", () => ({
  getProjectSettingsPath: () => "/tmp/settings.json",
  writeSettingsValue: (...args: unknown[]) => writeSettingsValue(...args),
}));

import { effectiveReasoningDepth, handleThink } from "./think.js";

describe("handleThink", () => {
  beforeEach(() => {
    setReasoningOverride(null);
    writeSettingsValue.mockClear();
  });

  afterEach(() => {
    setReasoningOverride(null);
  });

  it("reports the model default when no override is set", () => {
    expect(handleThink([]).output).toContain("medium");
  });

  it("reports the session override once set", () => {
    setReasoningOverride("high");
    expect(handleThink([]).output).toContain("high");
  });

  it("sets the override and persists it", () => {
    const result = handleThink(["low"]);
    expect(result.output).toContain("low");
    expect(writeSettingsValue).toHaveBeenCalledWith(
      "/tmp/settings.json",
      "reasoningEffort",
      "low",
    );
  });

  it("rejects an unknown depth", () => {
    const result = handleThink(["super"]);
    expect(result.output).toContain("super");
    expect(writeSettingsValue).not.toHaveBeenCalled();
  });

  it("accepts the zh label it printed as the depth", () => {
    const result = handleThink(["高"]);
    expect(result.output).toContain("high");
    expect(writeSettingsValue).toHaveBeenCalledWith(
      "/tmp/settings.json",
      "reasoningEffort",
      "high",
    );
  });

  it("lists every depth in the rejection message", () => {
    const result = handleThink(["super"]);
    for (const value of [
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "default",
    ]) {
      expect(result.output).toContain(value);
    }
  });

  it("effectiveReasoningDepth prefers the override", () => {
    expect(
      effectiveReasoningDepth({ defaultCompletionOptions: {} } as any),
    ).toBe("default");
    setReasoningOverride("off");
    expect(
      effectiveReasoningDepth({ defaultCompletionOptions: {} } as any),
    ).toBe("off");
  });
});
