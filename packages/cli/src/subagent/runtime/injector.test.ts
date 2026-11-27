import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSessionById = vi.hoisted(() => vi.fn());
vi.mock("../../session/index.js", () => ({ loadSessionById }));
vi.mock("./spawner.js", () => ({
  findSubagentRunBySessionId: () => ({ status: "done" }),
}));

import { readSubagentTranscript } from "./injector.js";

beforeEach(() => vi.clearAllMocks());

describe("readSubagentTranscript", () => {
  it("reads a child transcript for its parent", () => {
    loadSessionById.mockReturnValue({
      sessionId: "child-1",
      parentSessionId: "parent-1",
      subagentType: "explore",
      history: [{ message: { role: "assistant", content: "report" } }],
      pendingSubagentMessages: [],
    });

    expect(readSubagentTranscript("child-1", "parent-1")).toEqual({
      sessionId: "child-1",
      messages: [{ message: { role: "assistant", content: "report" } }],
      status: "done",
    });
  });

  it("does not expose another parent's transcript", () => {
    loadSessionById.mockReturnValue({
      sessionId: "child-1",
      parentSessionId: "foreign-parent",
      subagentType: "explore",
      history: [{ message: { role: "assistant", content: "secret" } }],
    });

    expect(readSubagentTranscript("child-1", "parent-1")).toBeNull();
  });

  it("does not treat a root session as a child transcript", () => {
    loadSessionById.mockReturnValue({
      sessionId: "root-1",
      history: [{ message: { role: "user", content: "private" } }],
    });

    expect(readSubagentTranscript("root-1", "parent-1")).toBeNull();
  });
});
