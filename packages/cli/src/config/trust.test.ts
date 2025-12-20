import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadPermissionPoliciesFromSettings } from "./settings.js";
import { getEffectiveSettingsFilePaths } from "./settingsFiles.js";
import { isProjectTrusted, projectConfigHash, trustProject } from "./trust.js";

describe("project trust", () => {
  const previousHome = process.env.CONTINUE_GLOBAL_DIR;
  let project: string;

  beforeEach(() => {
    process.env.CONTINUE_GLOBAL_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-trust-home-"),
    );
    project = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-trust-project-"));
    fs.mkdirSync(path.join(project, ".tnt"));
    fs.writeFileSync(
      path.join(project, ".tnt", "settings.json"),
      JSON.stringify({ permissions: { deny: ["Bash"] } }),
      "utf-8",
    );
  });

  afterAll(() => {
    if (previousHome === undefined) {
      delete process.env.CONTINUE_GLOBAL_DIR;
    } else {
      process.env.CONTINUE_GLOBAL_DIR = previousHome;
    }
  });

  it("treats a project with no config files as trusted", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-trust-empty-"));

    expect(projectConfigHash(empty)).toBeNull();
    expect(isProjectTrusted(empty)).toBe(true);
  });

  it("ignores project settings until the contents are trusted", () => {
    expect(isProjectTrusted(project)).toBe(false);

    const effective = getEffectiveSettingsFilePaths(project);
    expect(effective).not.toContain(
      path.join(project, ".tnt", "settings.json"),
    );
    expect(
      (loadPermissionPoliciesFromSettings(project) ?? []).some(
        (policy) => policy.tool === "Bash",
      ),
    ).toBe(false);
  });

  it("applies project settings after trustProject", () => {
    trustProject(project);

    expect(isProjectTrusted(project)).toBe(true);
    expect(getEffectiveSettingsFilePaths(project)).toContain(
      path.join(project, ".tnt", "settings.json"),
    );
    expect(loadPermissionPoliciesFromSettings(project)).toContainEqual({
      tool: "Bash",
      permission: "exclude",
    });
  });

  it("revokes trust when the project contents change", () => {
    trustProject(project);
    fs.appendFileSync(path.join(project, ".tnt", "settings.json"), "\n");

    expect(isProjectTrusted(project)).toBe(false);
  });
});
