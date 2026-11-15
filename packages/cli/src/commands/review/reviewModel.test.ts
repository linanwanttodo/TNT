import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ warns: [] as string[] }));

const sessionState = vi.hoisted(() => ({
  llmApi: { id: "session-api" },
  model: { name: "session-model", model: "gpt-x" },
  assistant: { models: [] },
  authConfig: null,
}));

vi.mock("../../services/ModelService.js", () => ({
  ModelService: {
    findModelByName: (_state: unknown, name: string) =>
      name === "cheap-model"
        ? {
            llmApi: { id: "cheap-api" },
            model: { name: "cheap-model", model: "haiku" },
            assistant: { models: [] },
            authConfig: null,
          }
        : null,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: (message: string) => captured.warns.push(message),
  },
}));

import { resolveReviewModelState } from "./reviewModel.js";

describe("the model a review runs on", () => {
  beforeEach(() => {
    captured.warns.length = 0;
  });

  it("runs on the session model when nothing was asked for", async () => {
    const state = await resolveReviewModelState(
      sessionState as never,
      undefined,
    );

    expect(state).toBe(sessionState);
    expect(captured.warns).toEqual([]);
  });

  it("runs on the named model when the configuration has it", async () => {
    const state = await resolveReviewModelState(
      sessionState as never,
      "cheap-model",
    );

    expect(state.llmApi).not.toBe(sessionState.llmApi);
    expect(state.model.name).toBe("cheap-model");
    expect(captured.warns).toEqual([]);
  });

  it("falls back to the session model and says which name missed", async () => {
    const state = await resolveReviewModelState(
      sessionState as never,
      "ghost-model",
    );

    // A mistyped name must not end the review: it costs more than expected, and
    // the log is the only place that says so.
    expect(state).toBe(sessionState);
    expect(captured.warns).toHaveLength(1);
    expect(captured.warns[0]).toContain("ghost-model");
  });
});
