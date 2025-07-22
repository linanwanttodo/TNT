import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env } from "../env.js";

import { getPluginCacheDirectory, getPluginsDirectory } from "./directories.js";
import { isBlockedMarketplaceName, loadAllPlugins } from "./loader.js";

function writeJson(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
}

function writeFile(target: string, value: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

describe("plugin directories", () => {
  it("places plugins under the TNT home", () => {
    expect(getPluginsDirectory()).toBe(path.join(env.continueHome, "plugins"));
  });

  it("honours the cache dir override with tilde expansion", () => {
    const previous = process.env.TNT_PLUGIN_CACHE_DIR;
    process.env.TNT_PLUGIN_CACHE_DIR = "~/custom-plugins";
    try {
      expect(getPluginsDirectory()).toBe(
        path.join(os.homedir(), "custom-plugins"),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TNT_PLUGIN_CACHE_DIR;
      } else {
        process.env.TNT_PLUGIN_CACHE_DIR = previous;
      }
    }
  });
});

describe("isBlockedMarketplaceName", () => {
  it("allows the reserved official names", () => {
    expect(isBlockedMarketplaceName("claude-plugins-official")).toBe(false);
  });

  it("blocks names that impersonate the official catalog", () => {
    expect(isBlockedMarketplaceName("claude-official")).toBe(true);
    expect(isBlockedMarketplaceName("official-anthropic-plugins")).toBe(true);
  });

  it("blocks non-ASCII homograph names", () => {
    expect(isBlockedMarketplaceName("аnthropic")).toBe(true);
  });

  it("allows ordinary third-party names", () => {
    expect(isBlockedMarketplaceName("acme-tools")).toBe(false);
  });
});

describe("loadAllPlugins", () => {
  const cacheRoot = getPluginCacheDirectory();
  let created: string[] = [];

  beforeEach(() => {
    created = [];
  });

  afterEach(() => {
    for (const dir of created) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function installPlugin(
    marketplace: string,
    plugin: string,
    version: string,
  ): string {
    const root = path.join(cacheRoot, marketplace, plugin, version);
    created.push(path.join(cacheRoot, marketplace));
    return root;
  }

  it("returns nothing when no plugins are installed", () => {
    const result = loadAllPlugins();
    expect(Array.isArray(result.plugins)).toBe(true);
    expect(result.plugins.length).toBe(0);
  });

  it("loads manifest, hooks, commands, agents, skills and mcp servers", () => {
    const root = installPlugin("acme", "demo", "1.0.0");

    writeJson(path.join(root, ".claude-plugin", "plugin.json"), {
      name: "demo",
      version: "1.0.0",
      description: "Demo plugin",
      mcpServers: {
        docs: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"] },
      },
    });

    writeJson(path.join(root, "hooks", "hooks.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo guard" }],
          },
        ],
      },
    });

    writeFile(
      path.join(root, "commands", "sync.md"),
      "Sync the project using ${CLAUDE_PLUGIN_ROOT}",
    );
    writeFile(path.join(root, "agents", "reviewer.md"), "You review code.");
    writeFile(
      path.join(root, "skills", "helper", "SKILL.md"),
      "name: helper\ndescription: Helps out\n",
    );

    const result = loadAllPlugins();

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe("demo@acme");
    expect(result.plugins[0].path).toBe(root);

    expect(result.hooks.config.PreToolUse).toHaveLength(1);
    expect(result.hooks.config.PreToolUse[0].matcher).toBe("Bash");

    expect(result.commands[0].name).toBe("demo:sync");
    expect(result.commands[0].content).toContain(root);

    expect(result.agents[0].name).toBe("reviewer");

    expect(result.skills[0].name).toBe("helper");
    expect(result.skills[0].description).toBe("Helps out");

    const mcpServer = result.mcpServers["demo-docs"] as {
      command: string;
      args: string[];
    };
    expect(mcpServer.command).toBe("node");
    expect(mcpServer.args[0]).toBe(path.join(root, "server.js"));
  });

  it("uses the newest version directory", () => {
    const older = installPlugin("acme", "versioned", "1.0.0");
    const newer = installPlugin("acme", "versioned", "2.0.0");

    writeJson(path.join(older, "plugin.json"), { name: "versioned" });
    writeJson(path.join(newer, "plugin.json"), {
      name: "versioned",
      version: "2.0.0",
    });

    const result = loadAllPlugins();
    const plugin = result.plugins.find((p) => p.name === "versioned");

    expect(plugin?.path).toBe(newer);
    expect(plugin?.version).toBe("2.0.0");
  });

  it("skips a plugin whose manifest is invalid", () => {
    const root = installPlugin("acme", "broken", "1.0.0");
    writeFile(path.join(root, "plugin.json"), "not json");

    const result = loadAllPlugins();
    expect(result.plugins.find((p) => p.name === "broken")).toBeUndefined();
  });
});
