import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  inputs: [] as Array<Record<string, unknown>>,
  nextResult: {} as Record<string, unknown>,
}));

vi.mock("../services/index.js", () => ({
  services: {
    hooks: {
      isReady: () => true,
      fireEvent: async (input: Record<string, unknown>) => {
        captured.inputs.push(input);
        return { blocked: false, results: [], ...captured.nextResult };
      },
    },
    toolPermissions: { isReady: () => false },
  },
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: () => ({ sessionId: "sess-1" }),
  getSessionFilePath: () => "/sessions/sess-1.json",
}));

import {
  fireSessionStart,
  fireUserPromptSubmit,
  takeSessionStartContext,
} from "./fireHook.js";

describe("SessionStart context delivery", () => {
  beforeEach(() => {
    captured.inputs.length = 0;
    captured.nextResult = {};
    // Drained so a case cannot read a note an earlier case left behind.
    takeSessionStartContext();
  });

  it("holds the note the hook wrote for the session", async () => {
    captured.nextResult = { additionalContext: "build with make" };

    await fireSessionStart("startup", "test-model");

    expect(takeSessionStartContext()).toBe("build with make");
  });

  it("gives the note to the first prompt only", async () => {
    captured.nextResult = { additionalContext: "note for the session" };
    await fireSessionStart("startup");

    expect(takeSessionStartContext()).toBe("note for the session");
    expect(takeSessionStartContext()).toBeUndefined();
  });

  it("holds nothing when the hook had no note", async () => {
    await fireSessionStart("resume");

    expect(takeSessionStartContext()).toBeUndefined();
  });

  it("sends the session file as the transcript path", async () => {
    await fireUserPromptSubmit("hello");

    const input = captured.inputs[captured.inputs.length - 1];
    // A hook that audits the run reads this path; an empty string told it there
    // was nothing to read when the session file exists.
    expect(input?.transcript_path).toBe("/sessions/sess-1.json");
    expect(input?.session_id).toBe("sess-1");
  });
});
