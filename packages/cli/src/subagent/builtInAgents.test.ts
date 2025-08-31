import { describe, expect, it } from "vitest";

import {
  BUILT_IN_AGENTS,
  VERIFICATION_AGENT,
  builtInAgentByName,
} from "./builtInAgents.js";

describe("built-in agents", () => {
  it("resolves the verifier by the name the listing tool shows", () => {
    expect(BUILT_IN_AGENTS.map((agent) => agent.name)).toEqual([
      "verification",
    ]);
    expect(builtInAgentByName("verification")).toBe(VERIFICATION_AGENT);
    expect(builtInAgentByName("configured-agent")).toBeUndefined();
  });

  it("restricts the verifier to no file writes, not to no shell", () => {
    // "readonly" would also drop Bash, and a checker that cannot run the build
    // is reading code and guessing.
    expect(VERIFICATION_AGENT.restriction).toBe("no-writes");
  });

  it("asks for the evidence and the verdict line the parser reads", () => {
    expect(VERIFICATION_AGENT.systemMessage).toMatch(/^VERDICT: PASS$/m);
    expect(VERIFICATION_AGENT.systemMessage).toContain("Command run:");
    expect(VERIFICATION_AGENT.systemMessage).toMatch(
      /cannot (change|create|modify|write) (files|anything)/,
    );
  });

  it("is described well enough to be chosen on", () => {
    expect(VERIFICATION_AGENT.description).toContain("verdict");
  });
});
