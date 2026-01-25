import { describe, expect, it } from "vitest";

import { ALL_BUILT_IN_TOOLS } from "../tools/allBuiltIns.js";

import {
  BUILT_IN_AGENTS,
  DEBUG_AGENT,
  EXPLORE_AGENT,
  SECURITY_REVIEW_AGENT,
  VERIFICATION_AGENT,
  builtInAgentByName,
} from "./builtInAgents.js";

describe("built-in agents", () => {
  it("offers the four roles by the names the listing tool shows", () => {
    expect(BUILT_IN_AGENTS.map((agent) => agent.name)).toEqual([
      "verification",
      "explore",
      "debug",
      "security-review",
    ]);
    expect(builtInAgentByName("verification")).toBe(VERIFICATION_AGENT);
    expect(builtInAgentByName("explore")).toBe(EXPLORE_AGENT);
    expect(builtInAgentByName("debug")).toBe(DEBUG_AGENT);
    expect(builtInAgentByName("security-review")).toBe(SECURITY_REVIEW_AGENT);
    expect(builtInAgentByName("configured-agent")).toBeUndefined();
  });

  it("keeps every role name unique and every description usable", () => {
    const names = BUILT_IN_AGENTS.map((agent) => agent.name);
    expect(new Set(names).size).toBe(names.length);
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.description.length, agent.name).toBeGreaterThan(40);
      expect(agent.systemMessage.length, agent.name).toBeGreaterThan(200);
    }
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

  it("keeps exploration read-only, including the shell", () => {
    expect(EXPLORE_AGENT.restriction).toBe("readonly");
    expect(EXPLORE_AGENT.systemMessage).toMatch(
      /cannot create or modify files/,
    );
    expect(EXPLORE_AGENT.description).toContain("file:line");
  });

  it("lets debugging run a failing command but not edit the fix", () => {
    expect(DEBUG_AGENT.restriction).toBe("no-writes");
    expect(DEBUG_AGENT.systemMessage).toMatch(/cannot create or modify files/);
    expect(DEBUG_AGENT.systemMessage).toContain("Root cause");
    expect(DEBUG_AGENT.systemMessage).toContain("Verification");
  });

  it("keeps the security review evidence-led and read-only for files", () => {
    expect(SECURITY_REVIEW_AGENT.restriction).toBe("no-writes");
    expect(SECURITY_REVIEW_AGENT.systemMessage).toContain("Severity");
    expect(SECURITY_REVIEW_AGENT.systemMessage).toMatch(
      /Do not report a style preference/,
    );
  });

  it("keeps AskQuestion and Exit away from every role", () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.deniedTools, agent.name).toEqual(["AskQuestion", "Exit"]);
    }
  });
});
