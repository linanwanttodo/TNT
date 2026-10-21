import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it, beforeEach, afterAll } from "vitest";

import {
  loadPermissionPoliciesFromSettings,
  loadSettings,
  settingsPermissionsToPolicies,
  settingsPath,
} from "./settings.js";
import { trustProject } from "./trust.js";

describe("settings.json", () => {
  const previousHome = process.env.CONTINUE_GLOBAL_DIR;

  beforeEach(() => {
    process.env.CONTINUE_GLOBAL_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-settings-"),
    );
  });

  afterAll(() => {
    if (previousHome === undefined) {
      delete process.env.CONTINUE_GLOBAL_DIR;
    } else {
      process.env.CONTINUE_GLOBAL_DIR = previousHome;
    }
  });

  const write = (value: unknown) =>
    fs.writeFileSync(settingsPath(), JSON.stringify(value), "utf-8");

  it("reads the user settings", () => {
    write({
      permissions: { allow: ["Read"], ask: ["Write"], deny: ["Bash"] },
      env: { TNT_LOG_LEVEL: "debug" },
      locale: "zh-CN",
      outputStyle: "concise",
      defaultMode: "plan",
    });

    const settings = loadSettings();
    expect(settings.permissions).toEqual({
      allow: ["Read"],
      ask: ["Write"],
      deny: ["Bash"],
    });
    expect(settings.locale).toBe("zh-CN");
  });

  it("drops model fields but keeps the rest of the file", () => {
    write({
      model: "claude",
      models: [{ name: "x" }],
      permissions: { allow: ["Read"] },
    });

    const settings = loadSettings();
    expect(settings.permissions).toEqual({ allow: ["Read"] });
    expect("model" in settings).toBe(false);
    expect("models" in settings).toBe(false);
  });

  it("maps deny to exclude, most restrictive first", () => {
    const policies = settingsPermissionsToPolicies({
      allow: ["Read"],
      ask: ["Write"],
      deny: ["Bash"],
    });

    expect(policies).toEqual([
      { tool: "Bash", permission: "exclude" },
      { tool: "Write", permission: "ask" },
      { tool: "Read", permission: "allow" },
    ]);
  });

  it("layers a project settings file over the user file", () => {
    write({ permissions: { allow: ["Read"] } });
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-project-"));
    fs.mkdirSync(path.join(project, ".tnt"));
    fs.writeFileSync(
      path.join(project, ".tnt", "settings.json"),
      JSON.stringify({ permissions: { deny: ["Bash"] }, locale: "zh-CN" }),
      "utf-8",
    );
    trustProject(project);

    expect(loadPermissionPoliciesFromSettings(project)).toEqual([
      { tool: "Bash", permission: "exclude" },
      { tool: "Read", permission: "allow" },
    ]);
    expect(loadSettings(project).locale).toBe("zh-CN");
  });

  it("prefers settings permissions over the legacy YAML", () => {
    fs.writeFileSync(
      path.join(process.env.CONTINUE_GLOBAL_DIR!, "permissions.yaml"),
      "allow:\n  - Bash\n",
      "utf-8",
    );
    write({ permissions: { allow: ["Read"] } });

    expect(loadPermissionPoliciesFromSettings()).toEqual([
      { tool: "Read", permission: "allow" },
    ]);
  });

  it("falls back to permissions.yaml for one version", () => {
    fs.writeFileSync(
      path.join(process.env.CONTINUE_GLOBAL_DIR!, "permissions.yaml"),
      "exclude:\n  - Bash\n",
      "utf-8",
    );

    expect(loadPermissionPoliciesFromSettings()).toEqual([
      { tool: "Bash", permission: "exclude" },
    ]);
  });
});
