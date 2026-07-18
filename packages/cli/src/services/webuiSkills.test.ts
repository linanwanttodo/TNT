import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadMarkdownSkills } from "../utils/loadMarkdownSkills.js";

import { createTntSkillsService } from "./webuiSkills.js";

function writeSkill(
  workspace: string,
  name: string,
  description: string,
): string {
  const directory = path.join(workspace, ".tnt", "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "SKILL.md");
  fs.writeFileSync(
    file,
    `---\nname: ${name}\ndescription: ${description}\n---\n\nUse this skill.\n`,
  );
  return file;
}

describe("createTntSkillsService", () => {
  const previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  let globalDir: string;
  let workspace: string;

  beforeEach(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-skills-global-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-skills-ws-"));
    process.env.TNT_GLOBAL_DIR = globalDir;
  });

  afterEach(() => {
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
    fs.rmSync(globalDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("lists a workspace skill with its real body and enable state", async () => {
    writeSkill(workspace, "deploy", "Deploys the app");
    const service = createTntSkillsService();
    const result = await service.list({ workspacePath: workspace });

    const skill = result.skills.find((entry) => entry.name === "deploy");
    expect(skill).toBeDefined();
    expect(skill?.scope).toBe("workspace");
    expect(skill?.enabled).toBe(true);
    expect(skill?.body).toContain("Use this skill.");
    expect(result.capability.userScopeAvailable).toBe(true);
  });

  it("filters a disabled skill out of the slash-command loader", async () => {
    const file = writeSkill(workspace, "deploy", "Deploys the app");
    const service = createTntSkillsService();
    await service.setEnabled({
      workspacePath: workspace,
      skillId: file,
      enabled: false,
    });

    const listed = await service.list({ workspacePath: workspace });
    expect(
      listed.skills.find((entry) => entry.name === "deploy")?.enabled,
    ).toBe(false);

    const loaded = await loadMarkdownSkills(workspace);
    expect(
      loaded.skills.find((entry) => entry.name === "deploy")?.enabled,
    ).toBe(false);
  });

  it("deletes the skill directory and refuses paths outside the roots", async () => {
    const file = writeSkill(workspace, "deploy", "Deploys the app");
    const service = createTntSkillsService();
    await service.deleteSkill({ workspacePath: workspace, skillId: file });
    expect(fs.existsSync(path.dirname(file))).toBe(false);

    await expect(
      service.deleteSkill({ workspacePath: workspace, skillId: "/etc/passwd" }),
    ).rejects.toThrow(/not in a workspace or user skill directory/);
  });
});
