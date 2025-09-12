import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ENABLED_PLUGINS_KEY,
  configuredEnabledPlugins,
  resolvePluginEnablement,
} from "./pluginEnablement.js";

let home = "";
let project = "";
let previousHome: string | undefined;
let previousGlobalDir: string | undefined;

function writeSettings(relativeToProject: string, value: unknown): void {
  const file = path.join(project, relativeToProject);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

/**
 * Installing a plugin is not enabling it. The list decides which installed
 * plugins may load, so a plugin can sit on disk - installed, updatable, and
 * silent - until the user opts in.
 */
describe("plugin enablement", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-enable-home-"));
    project = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-enable-project-"));
    previousHome = process.env.HOME;
    previousGlobalDir = process.env.CONTINUE_GLOBAL_DIR;
    process.env.HOME = home;
    process.env.CONTINUE_GLOBAL_DIR = path.join(home, ".tnt");
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGlobalDir === undefined) delete process.env.CONTINUE_GLOBAL_DIR;
    else process.env.CONTINUE_GLOBAL_DIR = previousGlobalDir;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  it("enables everything installed when no list is written", () => {
    expect(resolvePluginEnablement(["a", "b"], undefined)).toEqual({
      enabled: ["a", "b"],
      disabled: [],
      unknown: [],
    });
  });

  it("enables only what the list names, and calls the rest installed-but-idle", () => {
    expect(resolvePluginEnablement(["a", "b", "c"], ["c", "a"])).toEqual({
      // Discovery order, so the loaded set does not depend on how the list
      // was written.
      enabled: ["a", "c"],
      disabled: ["b"],
      unknown: [],
    });
  });

  it("names a list entry that is not installed, instead of ignoring it", () => {
    expect(resolvePluginEnablement(["a"], ["a", "typo"])).toEqual({
      enabled: ["a"],
      disabled: [],
      unknown: ["typo"],
    });
  });

  it("loads nothing when the list is empty, which is a decision of its own", () => {
    expect(resolvePluginEnablement(["a"], [])).toEqual({
      enabled: [],
      disabled: ["a"],
      unknown: [],
    });
  });

  it("reads the list from the settings files, later file winning", () => {
    writeSettings(".tnt/settings.json", { [ENABLED_PLUGINS_KEY]: ["early"] });
    writeSettings(".tnt/settings.local.json", {
      [ENABLED_PLUGINS_KEY]: ["late", " other "],
    });

    expect(configuredEnabledPlugins(project, home)).toEqual(["late", "other"]);
  });

  it("treats a missing or malformed value as no list at all", () => {
    writeSettings(".tnt/settings.json", { somethingElse: true });
    expect(configuredEnabledPlugins(project, home)).toBeUndefined();

    writeSettings(".tnt/settings.json", {
      [ENABLED_PLUGINS_KEY]: "not-a-list",
    });
    expect(configuredEnabledPlugins(project, home)).toBeUndefined();

    writeSettings(".tnt/settings.json", { [ENABLED_PLUGINS_KEY]: [] });
    expect(configuredEnabledPlugins(project, home)).toEqual([]);
  });
});
