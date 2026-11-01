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
const { mkdtempSync, rmSync } = await import("fs");
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

const GOAL = "让 /goal 命令的输出带上下文";

describe("the goal alignment line in the userRules section", () => {
  it("is absent without a goal: the session is byte-identical to the no-goal shape", async () => {
    const sections = await buildSystemMessageSections("default");

    expect(
      sections.find((section) => section.name === "userRules"),
    ).toBeUndefined();
  });

  it("carries the goal text without a team active: the generic layer works alone", async () => {
    sessionState.goal = GOAL;

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");

    expect(rules).toBeDefined();
    expect(rules?.volatile).toBe(true);
    expect(rules?.text).toContain(GOAL);
    expect(rules?.text).toContain("goal-align");
    // No receptionist discipline without an active team.
    expect(rules?.text).not.toContain("team-reception");
  });

  it("stays present when a team is active, next to the reception discipline", async () => {
    sessionState.goal = GOAL;
    sessionState.activeTeam = "dev";

    const sections = await buildSystemMessageSections("default");
    const rules = sections.find((section) => section.name === "userRules");

    expect(rules?.text).toContain("goal-align");
    expect(rules?.text).toContain(GOAL);
  });

  it("disappears on the next turn after /goal clear", async () => {
    sessionState.goal = GOAL;
    await buildSystemMessageSections("default");

    sessionState.goal = undefined;
    const after = await buildSystemMessageSections("default");

    expect(
      after.find((section) => section.name === "userRules"),
    ).toBeUndefined();
  });

  it("does not move between calls with the same goal (volatile latch)", async () => {
    sessionState.goal = GOAL;

    const first = await buildSystemMessageSections("default");
    const second = await buildSystemMessageSections("default");

    expect(first).toEqual(second);
  });
});
