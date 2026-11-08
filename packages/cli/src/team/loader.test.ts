import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../utils/logger.js";

import {
  getTeam,
  invalidateTeamCache,
  loadFileTeams,
  loadTeams,
} from "./loader.js";

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
): void {
  const memberDir = path.join(dir, ".tnt", "teams", team);
  fs.mkdirSync(memberDir, { recursive: true });
  fs.writeFileSync(
    path.join(memberDir, file),
    `---\n${frontmatter}\n---\n${body}\n`,
  );
}

function writeGlobalMember(
  team: string,
  file: string,
  frontmatter: string,
  body: string,
): void {
  const memberDir = path.join(globalRoot, "teams", team);
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
    writeGlobalMember("dev", "architect.md", ARCHITECT_MEMBER, "global body");
    writeGlobalMember(
      "dev",
      "reviewer.md",
      `name: reviewer
description: Reviews diffs
team: dev
lead: false
`,
      "global reviewer body",
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

    const teams = loadFileTeams(projectDir);
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

    const teams = loadFileTeams(projectDir);
    expect(teams).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("rejects a team with no lead member", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    writeMember(projectDir, "dev", "architect.md", PLAIN_MEMBER, "body");

    const teams = loadFileTeams(projectDir);
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

  it("parses a member's model from the frontmatter", () => {
    writeMember(
      projectDir,
      "dev",
      "lead.md",
      `name: lead
description: Leads the team
team: dev
lead: true
model: cheap-model
`,
      "body",
    );

    const lead = loadTeams(projectDir).find(
      (team) => team.name === "dev",
    )!.lead;
    expect(lead.model).toBe("cheap-model");
  });

  it("leaves an empty model undefined", () => {
    writeMember(
      projectDir,
      "dev",
      "lead.md",
      `name: lead
description: Leads the team
team: dev
lead: true
model: ""
`,
      "body",
    );

    const lead = loadTeams(projectDir).find(
      (team) => team.name === "dev",
    )!.lead;
    expect(lead.model).toBeUndefined();
  });

  it("ignores a non-string model and warns", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    writeMember(
      projectDir,
      "dev",
      "lead.md",
      `name: lead
description: Leads the team
team: dev
lead: true
model: 42
`,
      "body",
    );

    const lead = loadTeams(projectDir).find(
      (team) => team.name === "dev",
    )!.lead;
    expect(lead.model).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid model"));
  });

  it("keeps the model through the default/global/project layering", () => {
    const implementer = () =>
      loadTeams(projectDir)
        .find((team) => team.name === "dev")!
        .members.find((member) => member.name === "implementer")!;

    writeGlobalMember(
      "dev",
      "implementer.md",
      `name: implementer
description: Global implementer
team: dev
lead: false
model: global-model
`,
      "global body",
    );
    expect(implementer().model).toBe("global-model");
    expect(implementer().source).toBe("global");

    writeMember(
      projectDir,
      "dev",
      "implementer.md",
      `name: implementer
description: Project implementer
team: dev
lead: false
model: project-model
`,
      "project body",
    );
    expect(implementer().model).toBe("project-model");
    expect(implementer().systemMessage).toBe("project body");
    expect(implementer().source).toBe("project");
  });

  it("sees a file added after invalidateTeamCache", () => {
    const dev = () => getTeam("dev", projectDir);
    writeMember(projectDir, "dev", "lead.md", LEAD_MEMBER, "lead body");
    // The file lead replaces the default lead outright.
    expect(dev()!.lead.name).toBe("lead");

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
    expect(dev()!.members.find((m) => m.name === "second")?.systemMessage).toBe(
      "second body",
    );
  });

  it("sees an in-place edit inside an existing team directory without invalidateTeamCache", () => {
    const dev = () => getTeam("dev", projectDir);
    writeMember(projectDir, "dev", "lead.md", LEAD_MEMBER, "first body");
    expect(dev()!.lead.systemMessage).toBe("first body");

    // The roots' own mtime/size do not move when a file inside them changes,
    // so the fingerprint has to reach one level down or this goes stale.
    writeMember(projectDir, "dev", "lead.md", LEAD_MEMBER, "second body");
    expect(dev()!.lead.systemMessage).toBe("second body");
  });

  it("a file roster without a lead augments the default team, keeping the default lead", () => {
    const sec = () => getTeam("sec", projectDir);
    expect(sec()!.lead.name).toBe("security-review");

    writeMember(
      projectDir,
      "sec",
      "verification.md",
      `name: verification
description: User's own verifier
team: sec
lead: false
`,
      "user verifier body",
    );
    expect(sec()!.lead.name).toBe("security-review");
    expect(sec()!.members.find((m) => m.name === "verification")!.source).toBe(
      "project",
    );
  });

  it("a user roster entry replaces a same-named default member with a warning", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    // "verification" is a member of the compiled-in sec team.
    writeMember(
      projectDir,
      "sec",
      "verification.md",
      `name: verification
description: User's own verifier
team: sec
lead: false
`,
      "user verifier body",
    );

    const sec = loadTeams(projectDir).find((team) => team.name === "sec");
    expect(sec).toBeDefined();
    const verifiers = sec!.members.filter((m) => m.name === "verification");
    expect(verifiers).toHaveLength(1);
    expect(verifiers[0].source).toBe("project");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate"));
  });
});

const LEAD_MEMBER = `name: lead
description: Leads the team
team: dev
lead: true
`;
