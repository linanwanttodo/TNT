import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { invalidatePluginCache } from "../plugins/loader.js";

import { listInstalledPlugins, setPluginEnabled } from "./webuiPlugins.js";

describe("webui plugin registry", () => {
  let root: string;
  let pluginsDir: string;
  let projectDir: string;
  let previousCwd: string;
  let previousPluginsDir: string | undefined;
  let previousClaudePluginsDir: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-webui-plugins-"));
    pluginsDir = path.join(root, "plugins");
    projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    previousCwd = process.cwd();
    process.chdir(projectDir);
    previousPluginsDir = process.env.TNT_PLUGINS_DIR;
    previousClaudePluginsDir = process.env.TNT_CLAUDE_PLUGINS_DIR;
    process.env.TNT_PLUGINS_DIR = pluginsDir;
    process.env.TNT_CLAUDE_PLUGINS_DIR = path.join(root, "claude-plugins");
    invalidatePluginCache();
  });

  afterEach(() => {
    invalidatePluginCache();
    if (previousPluginsDir === undefined) {
      delete process.env.TNT_PLUGINS_DIR;
    } else {
      process.env.TNT_PLUGINS_DIR = previousPluginsDir;
    }
    if (previousClaudePluginsDir === undefined) {
      delete process.env.TNT_CLAUDE_PLUGINS_DIR;
    } else {
      process.env.TNT_CLAUDE_PLUGINS_DIR = previousClaudePluginsDir;
    }
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function installPlugin(
    marketplace: string,
    name: string,
    options: {
      command?: boolean;
      agent?: boolean;
      skill?: boolean;
      mcp?: boolean;
    } = {},
  ): string {
    const pluginRoot = path.join(
      pluginsDir,
      "cache",
      marketplace,
      name,
      "1.0.0",
    );
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        description: `${name} plugin`,
        ...(options.mcp
          ? { mcpServers: { docs: { command: "node", args: ["server.js"] } } }
          : {}),
      }),
    );
    if (options.command) {
      fs.mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
      fs.writeFileSync(
        path.join(pluginRoot, "commands", "run.md"),
        "Run the thing.",
      );
    }
    if (options.agent) {
      fs.mkdirSync(path.join(pluginRoot, "agents"), { recursive: true });
      fs.writeFileSync(
        path.join(pluginRoot, "agents", "review.md"),
        "Review the thing.",
      );
    }
    if (options.skill) {
      fs.mkdirSync(path.join(pluginRoot, "skills", "helper"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(pluginRoot, "skills", "helper", "SKILL.md"),
        "name: helper\ndescription: Helps out\n",
      );
    }
    return pluginRoot;
  }

  it("lists enabled and disabled plugins with per-plugin contribution counts", () => {
    installPlugin("acme", "alpha", {
      command: true,
      agent: true,
      skill: true,
      mcp: true,
    });
    installPlugin("acme", "beta");

    const snapshot = listInstalledPlugins(projectDir);
    const alpha = snapshot.plugins.find((plugin) => plugin.name === "alpha");
    const beta = snapshot.plugins.find((plugin) => plugin.name === "beta");

    expect(snapshot.plugins).toHaveLength(2);
    expect(alpha).toMatchObject({
      enabled: true,
      skills: 1,
      commands: 1,
      agents: 1,
      mcpServers: 1,
    });
    expect(beta).toMatchObject({
      enabled: true,
      skills: 0,
      commands: 0,
      agents: 0,
      mcpServers: 0,
    });
    expect(snapshot.skills[0]).toMatchObject({
      name: "helper",
      plugin: "alpha",
    });
    expect(snapshot.commands[0]?.plugin).toBe("alpha");
    expect(snapshot.agents[0]?.plugin).toBe("alpha");
    expect(snapshot.settingsPath).toBe(
      path.join(projectDir, ".tnt", "settings.json"),
    );
    expect(snapshot.pluginsDir).toBe(pluginsDir);
  });

  it("disables one plugin by materializing the project enablement list", () => {
    installPlugin("acme", "alpha", { command: true, skill: true });
    installPlugin("acme", "beta");

    const snapshot = setPluginEnabled("alpha", false, projectDir);
    expect(
      snapshot.plugins.find((plugin) => plugin.name === "alpha"),
    ).toMatchObject({ enabled: false, skills: 0, commands: 0 });
    expect(
      snapshot.plugins.find((plugin) => plugin.name === "beta")?.enabled,
    ).toBe(true);
    expect(snapshot.disabledPlugins).toEqual(["alpha"]);
    expect(snapshot.skills).toEqual([]);

    const settings = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".tnt", "settings.json"), "utf8"),
    ) as { enabledPlugins: string[] };
    expect(settings.enabledPlugins).toEqual(["beta"]);
  });

  it("enables a disabled plugin and keeps unknown names intact", () => {
    installPlugin("acme", "alpha");
    installPlugin("acme", "beta");
    fs.mkdirSync(path.join(projectDir, ".tnt"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".tnt", "settings.json"),
      JSON.stringify({ enabledPlugins: ["beta", "typo"] }),
    );

    const snapshot = setPluginEnabled("alpha", true, projectDir);
    expect(
      snapshot.plugins.find((plugin) => plugin.name === "alpha")?.enabled,
    ).toBe(true);
    expect(snapshot.unknownEnabledPlugins).toContain("typo");

    const settings = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".tnt", "settings.json"), "utf8"),
    ) as { enabledPlugins: string[] };
    expect(settings.enabledPlugins).toEqual(["beta", "typo", "alpha"]);
  });

  it("refuses an unknown plugin", () => {
    installPlugin("acme", "alpha");
    expect(() => setPluginEnabled("missing", true, projectDir)).toThrow(
      /not installed/,
    );
  });

  it("re-reads the listing after a plugin is installed on disk", () => {
    installPlugin("acme", "alpha");
    expect(listInstalledPlugins(projectDir).plugins).toHaveLength(1);
    installPlugin("acme", "beta");
    invalidatePluginCache();
    expect(listInstalledPlugins(projectDir).plugins).toHaveLength(2);
  });
});
