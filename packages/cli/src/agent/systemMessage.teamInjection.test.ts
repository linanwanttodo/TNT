import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The session module owns the active team; this suite controls that choice and
// leaves every other export of the module intact.
const activeTeam = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));
vi.mock("../session/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/index.js")>();
  return { ...actual, getSessionActiveTeam: () => activeTeam.value };
});
vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn().mockResolvedValue({ config: { rules: [] } }),
    set: vi.fn(),
  },
}));
vi.mock("../config/hubLoader.js", () => ({
  processRule: vi
    .fn()
    .mockImplementation((spec: string) => Promise.resolve(spec)),
}));

const { buildSystemMessageSections } =
  await vi.importActual<typeof import("./systemMessage.js")>(
    "./systemMessage.js",
  );
const { getTeam, invalidateTeamCache } = await import("../team/loader.js");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("fs");
const { tmpdir } = await import("os");
const { join } = await import("path");

let projectDir: string;
let previousCwd: string;

const LEAD = `---
name: lead
description: Leads the dev team
team: dev
lead: true
---

You lead the dev team: break the work down, dispatch briefs, collect verdicts.
`;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "tnt-team-inject-"));
  previousCwd = process.cwd();
  process.chdir(projectDir);
  mkdirSync(join(projectDir, ".tnt", "teams", "dev"), { recursive: true });
  writeFileSync(join(projectDir, ".tnt", "teams", "dev", "lead.md"), LEAD);
  invalidateTeamCache();
  activeTeam.value = undefined;
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(projectDir, { recursive: true, force: true });
  invalidateTeamCache();
  activeTeam.value = undefined;
});

describe("the active team lead prompt in the userRules section", () => {
  it("carries the reception block for the active team, and drops it when none is active", async () => {
    activeTeam.value = "dev";

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");

    expect(rules).toBeDefined();
    expect(rules?.volatile).toBe(true);
    expect(rules?.text).toContain("team-reception");
    expect(rules?.text).toContain('source="dev"');

    activeTeam.value = undefined;
    const off = await buildSystemMessageSections("default");
    const offRules = off.find((section) => section.name === "userRules");
    expect(offRules?.text ?? "").not.toContain("team-reception");
  });

  it("resolves through getTeam so the block names the roster's own team", async () => {
    activeTeam.value = "dev";

    const team = getTeam("dev", process.cwd());
    expect(team?.name).toBe("dev");

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");
    expect(rules?.text).toContain(`source="${team?.name}"`);
  });

  it("latches: two calls with the same active team produce the same text", async () => {
    activeTeam.value = "dev";

    const first = await buildSystemMessageSections("default");
    const second = await buildSystemMessageSections("default");

    expect(first).toEqual(second);
  });

  it("does not add a team-lead rules block when no rules and no team exist", async () => {
    const sections = await buildSystemMessageSections("default");

    expect(
      sections.find((section) => section.name === "userRules"),
    ).toBeUndefined();
  });

  it("resolves a default team's builtInRef lead to the same reception block", async () => {
    activeTeam.value = "sec";

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");

    expect(rules?.text).toContain('source="sec"');
    expect(rules?.text).toContain("the sec team is active");
  });

  // The goal-PRD design replaces the lead injection: the main agent's block is
  // the receptionist discipline (受理纪律), not the roster lead's prompt. The
  // lead prompt keeps flowing to the PM through the dispatch chain instead.
  it("injects the receptionist discipline, not the lead prompt", async () => {
    activeTeam.value = "dev";

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");

    expect(rules?.text).toContain("team-reception");
    expect(rules?.text).toContain("the dev team is active");
    // The lead's own prompt stays out: the lead is a team subagent now.
    expect(rules?.text).not.toContain("You lead the dev team");
  });

  it("keeps the discipline beside the goal alignment block", async () => {
    activeTeam.value = "dev";

    const { setSessionGoal, getSessionGoal } =
      await import("../session/index.js");
    setSessionGoal("把 goal-PRD 流程接完");
    expect(getSessionGoal()).toBeDefined();

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");
    const text = rules?.text ?? "";

    expect(text).toContain("goal-align");
    expect(text).toContain("team-reception");
    expect(text.indexOf("goal-align")).toBeLessThan(
      text.indexOf("team-reception"),
    );
  });
});
