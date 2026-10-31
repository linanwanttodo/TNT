import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../utils/logger.js";

import { getTeam, invalidateTeamCache, loadTeams } from "./loader.js";

let projectDir: string;
let globalRoot: string;
let previousGlobal: string | undefined;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-team-project-"));
  globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-team-global-"));
  previousGlobal = process.env.TNT_GLOBAL_DIR;
  process.env.TNT_GLOBAL_DIR = globalRoot;
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(globalRoot, { recursive: true, force: true });
  if (previousGlobal === undefined) {
    delete process.env.TNT_GLOBAL_DIR;
  } else {
    process.env.TNT_GLOBAL_DIR = previousGlobal;
  }
  invalidateTeamCache();
  vi.restoreAllMocks();
});

function writeMember(
  dir: string,
  team: string,
  file: string,
  frontmatter: string,
  body: string,
  isGlobal = false,
): void {
  const memberDir = isGlobal
    ? path.join(dir, "teams", team)
    : path.join(dir, ".tnt", "teams", team);
  fs.mkdirSync(memberDir, { recursive: true });
  fs.writeFileSync(
    path.join(memberDir, file),
    `---\n${frontmatter}\n---\n${body}\n`,
  );
}

const ARCHITECT_MEMBER = `name: architect
description: System design
team: dev
lead: true
restriction: readonly
`;

const PLAIN_MEMBER = `name: architect
description: System design
team: dev
lead: false
`;

describe("loadTeams", () => {
  it("merges the three layers with the project copy winning", () => {
    writeMember(
      projectDir,
      "dev",
      "architect.md",
      ARCHITECT_MEMBER,
      "project body",
    );
    writeMember(
      globalRoot,
      "dev",
      "architect.md",
      ARCHITECT_MEMBER,
      "global body",
      true,
    );
    writeMember(
      globalRoot,
      "dev",
      "reviewer.md",
      `name: reviewer
description: Reviews diffs
team: dev
lead: false
`,
      "global reviewer body",
      true,
    );

    const teams = loadTeams(projectDir);
    const dev = teams.find((team) => team.name === "dev");
    expect(dev).toBeDefined();
    const architect = dev!.members.find((m) => m.name === "architect");
    expect(architect!.systemMessage).toBe("project body");
    expect(architect!.source).toBe("project");
    const reviewer = dev!.members.find((m) => m.name === "reviewer");
    expect(reviewer!.source).toBe("global");
  });

  it("skips a file with no name and warns", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    writeMember(
      projectDir,
      "dev",
      "nameless.md",
      `description: Missing a name
team: dev
`,
      "body",
    );

    const teams = loadTeams(projectDir);
    const dev = teams.find((team) => team.name === "dev");
    expect(dev?.members ?? []).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("skips a malformed frontmatter file and warns", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const memberDir = path.join(projectDir, ".tnt", "teams", "dev");
    fs.mkdirSync(memberDir, { recursive: true });
    fs.writeFileSync(
      path.join(memberDir, "broken.md"),
      "not frontmatter at all",
    );

    const teams = loadTeams(projectDir);
    expect(teams).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("rejects a team with no lead member", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    writeMember(projectDir, "dev", "architect.md", PLAIN_MEMBER, "body");

    const teams = loadTeams(projectDir);
    expect(teams.find((team) => team.name === "dev")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("parses deniedTools and restriction from the frontmatter", () => {
    writeMember(
      projectDir,
      "dev",
      "lead.md",
      `name: lead
description: Leads the team
team: dev
lead: true
deniedTools: Exit, AskQuestion
`,
      "body",
    );

    const dev = loadTeams(projectDir).find((team) => team.name === "dev");
    const lead = dev!.lead;
    expect(lead.deniedTools).toEqual(["Exit", "AskQuestion"]);
    expect(lead.restriction).toBeUndefined();
  });

  it("sees a file added after invalidateTeamCache", () => {
    const dev = () => getTeam("dev", projectDir);
    writeMember(projectDir, "dev", "lead.md", LEAD_MEMBER, "lead body");
    expect(dev()!.members).toHaveLength(1);

    invalidateTeamCache();
    writeMember(
      projectDir,
      "dev",
      "second.md",
      `name: second
description: Second member
team: dev
`,
      "second body",
    );
    expect(dev()!.members).toHaveLength(2);
  });
});

const LEAD_MEMBER = `name: lead
description: Leads the team
team: dev
lead: true
`;
