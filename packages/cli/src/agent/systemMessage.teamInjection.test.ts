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
  it("carries the lead prompt of the active team, and drops it when none is active", async () => {
    activeTeam.value = "dev";

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");

    expect(rules).toBeDefined();
    expect(rules?.volatile).toBe(true);
    expect(rules?.text).toContain("You lead the dev team");
    expect(rules?.text).toContain('source="dev"');

    activeTeam.value = undefined;
    const off = await buildSystemMessageSections("default");
    const offRules = off.find((section) => section.name === "userRules");
    expect(offRules?.text ?? "").not.toContain("You lead the dev team");
  });

  it("injects through getTeam so the prompt is the roster's own bytes", async () => {
    activeTeam.value = "dev";

    const team = getTeam("dev", process.cwd());
    expect(team?.lead.systemMessage).toContain("You lead the dev team");

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");
    expect(rules?.text).toContain(team?.lead.systemMessage.trim() ?? "");
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
});
