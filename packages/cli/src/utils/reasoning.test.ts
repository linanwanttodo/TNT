import { describe, expect, it } from "vitest";

import { completedReasoning } from "./reasoning.js";

describe("completedReasoning", () => {
  it("marks the block as finished and keeps the text", () => {
    expect(completedReasoning("checking the parser", 1234)).toEqual({
      active: false,
      text: "checking the parser",
      startAt: 1234,
      endAt: 1234,
    });
  });

  it("records an end time, so a reader does not treat it as streaming", () => {
    const reasoning = completedReasoning("thought");

    expect(reasoning.endAt).toBeDefined();
    expect(reasoning.endAt).toBe(reasoning.startAt);
  });
});
