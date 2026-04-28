import { describe, expect, it } from "vitest";

import { builtInAgentByName } from "../subagent/builtInAgents.js";

import { DEFAULT_TEAMS } from "./defaultTeams.js";

describe("DEFAULT_TEAMS", () => {
  it("exposes the dev team with the spec roster's twelve members", () => {
    const dev = DEFAULT_TEAMS.find((team) => team.name === "dev");
    expect(dev).toBeDefined();
    expect(dev!.members.map((m) => m.name).sort()).toEqual(
      [
        "architect",
        "best-of-n",
        "code-reviewer",
        "debug",
        "docs-writer",
        "explore",
        "implementer",
        "project-manager",
        "requirements-analyst",
        "shell",
        "tester",
        "ui-designer",
      ].sort(),
    );
    expect(dev!.members).toHaveLength(12);
  });

  it("exposes the sec team with its five members", () => {
    const sec = DEFAULT_TEAMS.find((team) => team.name === "sec");
    expect(sec).toBeDefined();
    expect(sec!.members.map((m) => m.name).sort()).toEqual(
      [
        "hacker",
        "reverse-engineer",
        "security-review",
        "shell",
        "verification",
      ].sort(),
    );
  });

  it("gives each team exactly one lead", () => {
    for (const team of DEFAULT_TEAMS) {
      const leads = team.members.filter((m) => m.lead);
      expect(leads).toHaveLength(1);
      expect(team.lead.name).toBe(leads[0].name);
    }
  });

  it("resolves every builtInRef member against the built-in registry", () => {
    for (const team of DEFAULT_TEAMS) {
      for (const member of team.members) {
        if (!member.builtInRef) {
          continue;
        }
        expect(builtInAgentByName(member.builtInRef)).toBeDefined();
      }
    }
  });

  it("declares the hacker persona's authorized-targets-only scope", () => {
    const sec = DEFAULT_TEAMS.find((team) => team.name === "sec")!;
    const hacker = sec.members.find((m) => m.name === "hacker")!;
    expect(hacker.systemMessage).toMatch(/授权/);
    expect(hacker.systemMessage).toMatch(/不利用|仅报告|报告/);
  });

  it("marks every default member with the default source", () => {
    for (const team of DEFAULT_TEAMS) {
      for (const member of team.members) {
        expect(member.source).toBe("default");
        expect(member.team).toBe(team.name);
      }
    }
  });
});
