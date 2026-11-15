import type { Session } from "core/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatModelOption } from "../services/modelCatalog.js";
import { setReasoningOverride } from "../session/reasoningOverride.js";

import { applyTurnSelection, type TurnSelectionDeps } from "./turnSelection.js";

const session = {
  sessionId: "session-1",
  title: "Fixture",
  workspaceDirectory: "/workspace",
  history: [],
} as unknown as Session;

const MODELS: ChatModelOption[] = [
  { index: 0, name: "fast", provider: "openai", current: true },
  { index: 1, name: "claude", provider: "anthropic", current: false },
];

function fakeDeps(models: ChatModelOption[] = MODELS) {
  const switchModel = vi.fn(async (_index: number) => undefined);
  const setSessionModel = vi.fn();
  const setReasoning = vi.fn();
  const deps: TurnSelectionDeps = {
    listModels: () => models,
    switchModel,
    setSessionModel,
    setReasoning,
  };
  return { deps, switchModel, setSessionModel, setReasoning };
}

afterEach(() => {
  setReasoningOverride(null);
});

describe("applyTurnSelection", () => {
  it("switches to the named configured model and records it on the session", async () => {
    const { deps, switchModel, setSessionModel, setReasoning } = fakeDeps();

    await applyTurnSelection(
      session,
      {
        modelSelection: {
          providerId: "anthropic",
          modelId: "claude",
          options: { reasoningLevel: "high" },
        },
      },
      deps,
    );

    expect(switchModel).toHaveBeenCalledWith(1);
    expect(setSessionModel).toHaveBeenCalledWith(session, {
      providerId: "anthropic",
      modelId: "claude",
      options: { reasoningLevel: "high" },
    });
    expect(setReasoning).toHaveBeenCalledWith("high");
  });

  it("records the session model without switching when it is already current", async () => {
    const { deps, switchModel, setSessionModel } = fakeDeps();

    await applyTurnSelection(
      session,
      { modelSelection: { providerId: "openai", modelId: "fast" } },
      deps,
    );

    expect(switchModel).not.toHaveBeenCalled();
    expect(setSessionModel).toHaveBeenCalledWith(session, {
      providerId: "openai",
      modelId: "fast",
    });
  });

  it("rejects an unknown provider/model instead of keeping the old model", async () => {
    const { deps, switchModel, setSessionModel, setReasoning } = fakeDeps();

    await expect(
      applyTurnSelection(
        session,
        { modelSelection: { providerId: "openai", modelId: "missing" } },
        deps,
      ),
    ).rejects.toThrow("Unknown model: openai/missing");
    expect(switchModel).not.toHaveBeenCalled();
    expect(setSessionModel).not.toHaveBeenCalled();
    expect(setReasoning).not.toHaveBeenCalled();
  });

  it("maps a raw send thoughtLevel to the reasoning override", async () => {
    const { deps, setReasoning } = fakeDeps();

    await applyTurnSelection(session, { thoughtLevel: "low" }, deps);

    expect(setReasoning).toHaveBeenCalledWith("low");
  });

  it("rejects an unknown reasoning level before switching models", async () => {
    const { deps, switchModel, setReasoning } = fakeDeps();

    await expect(
      applyTurnSelection(
        session,
        {
          modelSelection: {
            providerId: "anthropic",
            modelId: "claude",
            options: { reasoningLevel: "extreme" },
          },
        },
        deps,
      ),
    ).rejects.toThrow("Unknown reasoning level: extreme");
    expect(switchModel).not.toHaveBeenCalled();
    expect(setReasoning).not.toHaveBeenCalled();
  });

  it("does nothing for a turn that carries no selection", async () => {
    const { deps, switchModel, setSessionModel, setReasoning } = fakeDeps();

    await applyTurnSelection(session, {}, deps);

    expect(switchModel).not.toHaveBeenCalled();
    expect(setSessionModel).not.toHaveBeenCalled();
    expect(setReasoning).not.toHaveBeenCalled();
  });
});
