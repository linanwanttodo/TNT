import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The session module owns the goal and the active team; this suite controls
// both and leaves every other export of the module intact.
const sessionState = vi.hoisted(() => ({
  goal: undefined as string | undefined,
  activeTeam: undefined as string | undefined,
}));
vi.mock("../session/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/index.js")>();
  return {
    ...actual,
    getSessionGoal: () => sessionState.goal,
    getSessionActiveTeam: () => sessionState.activeTeam,
  };
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
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("fs");
const { tmpdir } = await import("os");
const { join } = await import("path");

let projectDir: string;
let previousCwd: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "tnt-goal-align-"));
  previousCwd = process.cwd();
  process.chdir(projectDir);
  sessionState.goal = undefined;
  sessionState.activeTeam = undefined;
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(projectDir, { recursive: true, force: true });
  sessionState.goal = undefined;
  sessionState.activeTeam = undefined;
});

function writeProjectSetting(key: string, value: unknown): void {
  const dir = join(projectDir, ".tnt");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "settings.json"),
    `${JSON.stringify({ [key]: value }, null, 2)}\n`,
  );
}

const GOAL = "让 /goal 命令的输出带上下文";

/** The rules block is split per source; its text is every userRules section. */
function rulesText(
  sections: readonly { name: string; text: string }[],
): string {
  return sections
    .filter((section) => section.name.startsWith("userRules"))
    .map((section) => section.text)
    .join("");
}

describe("the goal alignment line in the userRules section", () => {
  it("is absent without a goal: the session is byte-identical to the no-goal shape", async () => {
    const sections = await buildSystemMessageSections("default");

    expect(
      sections.find((section) => section.name.startsWith("userRules")),
    ).toBeUndefined();
  });

  it("carries the goal text without a team active: the generic layer works alone", async () => {
    sessionState.goal = GOAL;

    const sections = await buildSystemMessageSections("default");
    const rules = rulesText(sections);

    expect(sections.some((section) => section.name === "userRules")).toBe(true);
    expect(rules).toContain(GOAL);
    expect(rules).toContain("goal-align");
    // No receptionist discipline without an active team.
    expect(rules).not.toContain("team-reception");
  });

  it("stays present when a team is active, next to the reception discipline", async () => {
    sessionState.goal = GOAL;
    sessionState.activeTeam = "dev";

    const sections = await buildSystemMessageSections("default");
    const rules = rulesText(sections);

    expect(rules).toContain("goal-align");
    expect(rules).toContain(GOAL);
  });

  it("disappears on the next turn after /goal clear", async () => {
    sessionState.goal = GOAL;
    await buildSystemMessageSections("default");

    sessionState.goal = undefined;
    const after = await buildSystemMessageSections("default");

    expect(
      after.find((section) => section.name.startsWith("userRules")),
    ).toBeUndefined();
  });

  it("does not move between calls with the same goal (volatile latch)", async () => {
    sessionState.goal = GOAL;

    const first = await buildSystemMessageSections("default");
    const second = await buildSystemMessageSections("default");

    expect(first).toEqual(second);
  });
});

describe("the autoConvoke instruction in the userRules section", () => {
  it("is absent when the switch is unset or false: no auto-convoke is the anti-goal guard", async () => {
    sessionState.goal = GOAL;

    const unset = await buildSystemMessageSections("default");
    expect(rulesText(unset).includes("convoke")).toBe(false);

    writeProjectSetting("team.autoConvoke", false);
    const off = await buildSystemMessageSections("default");
    expect(rulesText(off).includes("convoke")).toBe(false);
  });

  it("carries the convoke instruction when the switch is true, riding the volatile section", async () => {
    sessionState.goal = GOAL;
    writeProjectSetting("team.autoConvoke", true);

    const sections = await buildSystemMessageSections("default");
    const rules = rulesText(sections);

    expect(sections.some((section) => section.name === "userRules")).toBe(true);
    expect(rules).toContain("goal-align");
    expect(rules).toContain("team-convoke");
  });

  it("vanishes on the next turn when the switch turns off", async () => {
    sessionState.goal = GOAL;
    writeProjectSetting("team.autoConvoke", true);
    await buildSystemMessageSections("default");

    writeProjectSetting("team.autoConvoke", false);
    const after = await buildSystemMessageSections("default");

    expect(rulesText(after).includes("team-convoke")).toBe(false);
  });
});
