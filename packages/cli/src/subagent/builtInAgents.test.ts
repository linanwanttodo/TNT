import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "../tools/allBuiltIns.js";

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

  it("denies only tools that exist, so a deny entry always bites", () => {
    const toolNames = new Set(ALL_BUILT_IN_TOOLS.map((tool) => tool.name));
    for (const agent of BUILT_IN_AGENTS) {
      for (const name of agent.deniedTools ?? []) {
        expect(toolNames.has(name)).toBe(true);
      }
    }
  });

  it("keeps AskQuestion and Exit away from the verifier", () => {
    // AskQuestion would block a delegated run nobody is watching; Exit would
    // end the process the verdict is being reported to.
    expect(VERIFICATION_AGENT.deniedTools).toEqual(["AskQuestion", "Exit"]);
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
