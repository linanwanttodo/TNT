import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env } from "../config/env.js";

import { getPluginCacheDirectory, getPluginsDirectory } from "./directories.js";
import {
  isBlockedMarketplaceName,
  loadAllPlugins,
  selectForcedOutputStyle,
} from "./loader.js";

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

  it("loads output styles from the default directory and the manifest", () => {
    const root = installPlugin("acme", "stylepack", "1.0.0");

    writeJson(path.join(root, ".claude-plugin", "plugin.json"), {
      name: "stylepack",
      version: "1.0.0",
      outputStyles: "./styles/extra.md",
    });

    writeFile(
      path.join(root, "output-styles", "terse.md"),
      "---\nname: terse\ndescription: Short answers\nforce-for-plugin: true\n---\n\nAnswer in one line.\n",
    );
    writeFile(
      path.join(root, "styles", "extra.md"),
      "Explain your reasoning using ${CLAUDE_PLUGIN_ROOT} notes.",
    );

    const styles = loadAllPlugins().outputStyles.filter(
      (style) => style.plugin === "stylepack",
    );

    expect(styles.map((style) => style.name).sort()).toEqual([
      "stylepack:extra",
      "stylepack:terse",
    ]);

    const terse = styles.find((style) => style.name === "stylepack:terse");
    expect(terse?.description).toBe("Short answers");
    expect(terse?.prompt).toBe("Answer in one line.");
    expect(terse?.forceForPlugin).toBe(true);

    const extra = styles.find((style) => style.name === "stylepack:extra");
    expect(extra?.description).toBe("Output style from stylepack");
    expect(extra?.forceForPlugin).toBeUndefined();
    expect(extra?.prompt).toContain(root);
  });

  it("reads the force flag written as a string", () => {
    const root = installPlugin("acme", "stringflag", "1.0.0");

    writeJson(path.join(root, "plugin.json"), { name: "stringflag" });
    writeFile(
      path.join(root, "output-styles", "loud.md"),
      '---\nforce-for-plugin: "true"\n---\n\nBe loud.\n',
    );

    const styles = loadAllPlugins().outputStyles.filter(
      (style) => style.plugin === "stringflag",
    );

    expect(styles).toHaveLength(1);
    expect(styles[0].forceForPlugin).toBe(true);
  });

  it("selects the forced style and ignores the offered ones", () => {
    const offered = {
      name: "demo:offered",
      plugin: "demo",
      description: "",
      prompt: "offered",
    };
    const forced = {
      name: "demo:forced",
      plugin: "demo",
      description: "",
      prompt: "forced",
      forceForPlugin: true,
    };

    expect(selectForcedOutputStyle([offered])).toBeUndefined();
    expect(selectForcedOutputStyle([offered, forced])?.name).toBe(
      "demo:forced",
    );
  });

  it("loads lsp servers from an inline entry and a config file", () => {
    const root = installPlugin("acme", "lspack", "1.0.0");

    writeJson(path.join(root, ".claude-plugin", "plugin.json"), {
      name: "lspack",
      version: "1.0.0",
      lspServers: [
        {
          typescript: {
            command: "typescript-language-server",
            args: ["--stdio"],
            root: "${CLAUDE_PLUGIN_ROOT}",
          },
        },
        "./lsp/python.json",
      ],
    });
    writeJson(path.join(root, "lsp", "python.json"), {
      pyright: { command: "pyright-langserver", args: ["--stdio"] },
    });

    const servers = loadAllPlugins().lspServers.filter(
      (server) => server.plugin === "lspack",
    );
    const names = servers.map((server) => server.name);

    expect(names).toContain("lspack-typescript");
    expect(names).toContain("lspack-pyright");

    const typescript = servers.find(
      (server) => server.name === "lspack-typescript",
    );
    expect(typescript?.config.command).toBe("typescript-language-server");
    expect(typescript?.config.root).toBe(root);
  });
});
