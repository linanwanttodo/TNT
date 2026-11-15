import { describe, expect, it } from "vitest";

import { builtInAgentByName } from "../subagent/builtInAgents.js";

import { DEFAULT_TEAMS } from "./defaultTeams.js";

describe("DEFAULT_TEAMS", () => {
  it("exposes the dev team with the spec roster's thirteen members", () => {
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
        "research",
        "shell",
        "tester",
        "ui-designer",
      ].sort(),
    );
    expect(dev!.members).toHaveLength(13);
  });

  it("exposes the sec team with its six members", () => {
    const sec = DEFAULT_TEAMS.find((team) => team.name === "sec");
    expect(sec).toBeDefined();
    expect(sec!.members.map((m) => m.name).sort()).toEqual(
      [
        "hacker",
        "research",
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

  // The goal-PRD design redefines the PM from "lead who dispatches" to
  // "manager who produces the PRD and the iteration plan"; dispatch stays with
  // the main agent's receptionist arm.
  it("defines the PM as the PRD manager, not a dispatcher", () => {
    const dev = DEFAULT_TEAMS.find((team) => team.name === "dev")!;
    const pm = dev.members.find((m) => m.name === "project-manager")!;

    expect(pm.systemMessage).toMatch(/PRD/);
    expect(pm.systemMessage).toContain("pre-mortem");
    expect(pm.systemMessage).toContain("迭代计划");
    expect(pm.systemMessage).toContain("变更记录");
    // Dispatch is not the PM's job anymore.
    expect(pm.systemMessage).not.toMatch(/派发 brief/);
    // The PM owns the state vocabulary and the PRD state machine.
    expect(pm.systemMessage).toMatch(/待开发/);
    expect(pm.systemMessage).toMatch(/已验收/);
  });

  it("declares the PRD file contract with its nine sections", () => {
    const dev = DEFAULT_TEAMS.find((team) => team.name === "dev")!;
    const pm = dev.members.find((m) => m.name === "project-manager")!;

    for (const section of [
      "背景与目标",
      "用户与场景",
      "功能范围",
      "详细需求",
      "非功能需求",
      "迭代计划",
      "风险",
      "变更记录",
      "验收记录",
    ]) {
      expect(pm.systemMessage).toContain(section);
    }
    expect(pm.systemMessage).toContain(".tnt/prd/");
  });

  it("derives the requirements-analyst prompt from the PRD contract", () => {
    const dev = DEFAULT_TEAMS.find((team) => team.name === "dev")!;
    const analyst = dev.members.find((m) => m.name === "requirements-analyst")!;

    expect(analyst.systemMessage).toContain("PRD");
    // Every requirement must carry a decidable acceptance criterion.
    expect(analyst.systemMessage).toMatch(/验收标准/);
    expect(analyst.systemMessage).toMatch(/不可判定/);
  });

  it("closes every flow report with one of the six state words", () => {
    const dev = DEFAULT_TEAMS.find((team) => team.name === "dev")!;
    const pm = dev.members.find((m) => m.name === "project-manager")!;
    const tester = dev.members.find((m) => m.name === "tester")!;

    for (const state of [
      "progress",
      "waiting",
      "ready",
      "blocked",
      "failed",
      "dropped",
    ]) {
      expect(pm.systemMessage).toContain(state);
      expect(tester.systemMessage).toContain(state);
    }
    // A draft in flight is not blocked.
    expect(pm.systemMessage).toMatch(/草稿.*不算|不算.*blocked|未完成草稿/);
  });
});
