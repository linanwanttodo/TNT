import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getSessionActiveTeam,
  setSessionActiveTeam,
  setSessionGoal,
} from "../../../session/index.js";
import { invalidateTeamCache } from "../../../team/loader.js";

import { handleTeamCommand } from "./team.js";

let projectDir: string;
let globalRoot: string;
let previousGlobal: string | undefined;

function writeMember(
  dir: string,
  team: string,
  file: string,
  frontmatter: string,
  body: string,
): void {
  const memberDir = path.join(dir, ".tnt", "teams", team);
  fs.mkdirSync(memberDir, { recursive: true });
  fs.writeFileSync(
    path.join(memberDir, file),
    `---\n${frontmatter}\n---\n${body}\n`,
  );
}

const LEAD = `name: lead
description: Leads the team
team: dev
lead: true
`;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-team-cmd-"));
  globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-team-cmd-global-"));
  previousGlobal = process.env.TNT_GLOBAL_DIR;
  process.env.TNT_GLOBAL_DIR = globalRoot;
  const previousCwd = process.cwd();
  process.chdir(projectDir);
  (afterEach as any)._previousCwd = previousCwd;
});

afterEach(() => {
  process.chdir((afterEach as any)._previousCwd);
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
  if (previousGlobal === undefined) {
    delete process.env.TNT_GLOBAL_DIR;
  } else {
    process.env.TNT_GLOBAL_DIR = previousGlobal;
  }
  setSessionActiveTeam(undefined);
  invalidateTeamCache();
});

describe("the /team command", () => {
  it("lists the teams and the active state", () => {
    writeMember(projectDir, "dev", "lead.md", LEAD, "lead prompt body");
    writeMember(
      projectDir,
      "sec",
      "lead.md",
      `name: seclead
description: Leads sec
team: sec
lead: true
`,
      "sec lead body",
    );
    invalidateTeamCache();

    const result = handleTeamCommand([]);

    expect(result.output).toContain("dev");
    expect(result.output).toContain("sec");
    expect(result.output).toContain("No team active");
  });

  it("activates a team and reports the new state", () => {
    writeMember(projectDir, "dev", "lead.md", LEAD, "lead prompt body");
    invalidateTeamCache();

    const result = handleTeamCommand(["dev"]);

    expect(result.output).toContain("dev");
    expect(getSessionActiveTeam()).toBe("dev");
  });

  // The goal-PRD flow needs a goal to work on: activating a team without one
  // is an explicit ask to set /goal first, never a silent start.
  it("asks for /goal when a team is activated without one", () => {
    writeMember(projectDir, "dev", "lead.md", LEAD, "lead prompt body");
    invalidateTeamCache();

    const result = handleTeamCommand(["dev"]);

    expect(getSessionActiveTeam()).toBe("dev");
    expect(result.output).toContain("/goal");
  });

  it("reports the goal with the activation message when one is set", () => {
    writeMember(projectDir, "dev", "lead.md", LEAD, "lead prompt body");
    invalidateTeamCache();
    setSessionGoal("给 /goal 流程接上团队");

    const result = handleTeamCommand(["dev"]);

    expect(getSessionActiveTeam()).toBe("dev");
    expect(result.output).toContain("给 /goal 流程接上团队");
    setSessionGoal(undefined);
  });

  it("deactivates with off", () => {
    writeMember(projectDir, "dev", "lead.md", LEAD, "lead prompt body");
    invalidateTeamCache();
    setSessionActiveTeam("dev");

    const result = handleTeamCommand(["off"]);

    expect(getSessionActiveTeam()).toBeUndefined();
    expect(result.output).toBeDefined();
  });

  it("names the available teams when the argument matches nothing", () => {
    writeMember(projectDir, "dev", "lead.md", LEAD, "lead prompt body");
    invalidateTeamCache();

    const result = handleTeamCommand(["platform"]);

    expect(result.output).toContain("platform");
    expect(result.output).toContain("dev");
  });

  it("creates a roster template in .tnt/teams", () => {
    inRosterWorkspace(() => {
      const result = handleTeamCommand(["create", "platform"]);

      expect(result.output).toContain("platform");
      const template = path.join(
        projectDir,
        ".tnt",
        "teams",
        "platform",
        "lead.md",
      );
      expect(fs.existsSync(template)).toBe(true);
      const body = fs.readFileSync(template, "utf-8");
      expect(body).toContain("name:");
      expect(body).toContain("lead: true");
    });
  });

  it("refuses to create a roster that already exists", () => {
    inRosterWorkspace(() => {
      handleTeamCommand(["create", "platform"]);
      const result = handleTeamCommand(["create", "platform"]);

      expect(result.output).toContain("platform");
      expect(result.output).toMatch(/exists|already/i);
    });
  });
});

function inRosterWorkspace(run: () => void): void {
  run();
}
