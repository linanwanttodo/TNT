import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSettingsString } from "../config/settingsFiles.js";

import { loadAllPlugins } from "./loader.js";
import { getPluginSettingsBase } from "./pluginSettings.js";

/**
 * A plugin manifest may declare settings; they become the lowest layer of the
 * settings cascade, so no settings file has to be hand-edited to use a
 * plugin's defaults - and no plugin can overrule what the user wrote.
 */
let pluginsDir: string;
let workspace: string;
let homeDir: string;
let previousPluginsDir: string | undefined;
let previousHome: string | undefined;
let previousCwd: string;

function writePlugin(name: string, settings: Record<string, unknown>): void {
  const root = path.join(pluginsDir, "cache", "acme", name, "1.0.0");
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, settings }),
  );
}

beforeEach(() => {
  previousPluginsDir = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-plugin-settings-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-plugin-ws-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-plugin-home-"));
  // os.homedir() reads $HOME on POSIX at call time; a temp home keeps the
  // settings lookup from seeing (or writing) the real user's files.
  previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  previousCwd = process.cwd();
  process.chdir(workspace);
});

afterEach(() => {
  process.chdir(previousCwd);
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousPluginsDir === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousPluginsDir;
  }
  fs.rmSync(pluginsDir, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe("settings a plugin declares", () => {
  it("become the lowest layer: any settings file outranks them", () => {
    writePlugin("voice", { outputStyle: "voice:terse" });
    loadAllPlugins();
    expect(readSettingsString("outputStyle")).toBe("voice:terse");

    fs.mkdirSync(path.join(workspace, ".tnt"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, ".tnt", "settings.json"),
      JSON.stringify({ outputStyle: "user:choice" }),
    );

    expect(readSettingsString("outputStyle")).toBe("user:choice");
  });

  it("keep only the allowlisted keys", () => {
    writePlugin("voice", {
      outputStyle: "voice:terse",
      permissions: { allow: ["Bash"] },
    });

    loadAllPlugins();

    expect(getPluginSettingsBase()).toEqual({
      outputStyle: "voice:terse",
    });
    expect(readSettingsString("permissions")).toBeUndefined();
  });

  it("let the later plugin name win the key two of them declare", () => {
    writePlugin("second", { outputStyle: "second:style" });
    writePlugin("first", { outputStyle: "first:style" });

    loadAllPlugins();

    expect(readSettingsString("outputStyle")).toBe("second:style");
  });

  it("contribute nothing when the manifest declares no settings", () => {
    writePlugin("plain", {});

    loadAllPlugins();

    expect(getPluginSettingsBase()).toBeUndefined();
    expect(readSettingsString("outputStyle")).toBeUndefined();
  });
});
