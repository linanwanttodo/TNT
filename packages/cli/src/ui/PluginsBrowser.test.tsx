import fs from "fs";
import os from "os";
import path from "path";

import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "../i18n/index.js";
import { invalidatePluginCache } from "../plugins/loader.js";

import { PluginsBrowser } from "./PluginsBrowser.js";

const tick = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

function catalogPath(pluginsDir: string, marketplace: string): string {
  return path.join(
    pluginsDir,
    "marketplaces",
    marketplace,
    ".claude-plugin",
    "marketplace.json",
  );
}

describe("PluginsBrowser", () => {
  let root: string;
  let pluginsDir: string;
  let projectDir: string;
  let previousCwd: string;
  let previousPluginsDir: string | undefined;
  let previousClaudePluginsDir: string | undefined;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-plugins-browser-"));
    pluginsDir = path.join(root, "plugins");
    projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    previousCwd = process.cwd();
    process.chdir(projectDir);
    previousPluginsDir = process.env.TNT_PLUGINS_DIR;
    previousClaudePluginsDir = process.env.TNT_CLAUDE_PLUGINS_DIR;
    process.env.TNT_PLUGINS_DIR = pluginsDir;
    process.env.TNT_CLAUDE_PLUGINS_DIR = path.join(root, "claude-empty");
    fs.mkdirSync(process.env.TNT_CLAUDE_PLUGINS_DIR, { recursive: true });
    invalidatePluginCache();
    setLocale("en");
    onCancel = vi.fn();
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
    vi.restoreAllMocks();
  });

  function writeKnownMarketplaces(entries: Record<string, string>): void {
    const known: Record<string, unknown> = {};
    for (const [name, installLocation] of Object.entries(entries)) {
      known[name] = {
        source: { source: "directory", path: path.dirname(installLocation) },
        installLocation,
        lastUpdated: "2026-01-01T00:00:00.000Z",
      };
    }
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, "known_marketplaces.json"),
      JSON.stringify(known),
    );
  }

  function writeMarketplace(
    name: string,
    plugins: Record<string, unknown>[],
  ): string {
    const manifestPath = catalogPath(pluginsDir, name);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ name, owner: { name: "Tester" }, plugins }),
    );
    return manifestPath;
  }

  function installOnDisk(
    marketplace: string,
    name: string,
    version: string,
    manifest: Record<string, unknown> = {},
  ): string {
    const dir = path.join(pluginsDir, "cache", marketplace, name, version);
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, version, ...manifest }),
    );
    return dir;
  }

  function writeSourcePlugin(
    marketplace: string,
    relative: string,
    manifest: Record<string, unknown>,
  ): string {
    const dir = path.join(pluginsDir, "marketplaces", marketplace, relative);
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify(manifest),
    );
    return dir;
  }

  function writeEnabledPlugins(names: string[]): void {
    const dir = path.join(projectDir, ".tnt");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ enabledPlugins: names }),
    );
  }

  it("renders the details view with metadata and declared components", async () => {
    const manifestPath = writeMarketplace("alpha-market", [
      {
        name: "hello",
        source: "./plugins/hello",
        version: "1.0.0",
        description: "Hello plugin",
        author: { name: "Alice" },
      },
    ]);
    writeKnownMarketplaces({ "alpha-market": manifestPath });
    const installedDir = installOnDisk("alpha-market", "hello", "1.0.0", {
      description: "Hello plugin",
      author: { name: "Alice" },
      commands: ["./commands"],
      agents: ["./agents"],
      skills: ["./skills"],
      mcpServers: { calc: { command: "node" } },
    });
    fs.mkdirSync(path.join(installedDir, "commands"), { recursive: true });
    fs.writeFileSync(
      path.join(installedDir, "commands", "greet.md"),
      "# greet",
    );
    fs.mkdirSync(path.join(installedDir, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(installedDir, "agents", "review.md"),
      "# review",
    );
    fs.mkdirSync(path.join(installedDir, "skills", "triage"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(installedDir, "skills", "triage", "SKILL.md"),
      "---\nname: triage\n---\n",
    );

    const tree = render(<PluginsBrowser onCancel={onCancel} />);
    try {
      await tick();
      tree.stdin.write("\r");
      await tick();

      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("hello@alpha-market");
      expect(frame).toContain("Version: 1.0.0");
      expect(frame).toContain("Status: enabled");
      expect(frame).toContain("Hello plugin");
      expect(frame).toContain("Author: Alice");
      expect(frame).toContain("Marketplace: alpha-market");
      expect(frame).toContain("Source: ./plugins/hello");
      expect(frame).toContain("Will install:");
      expect(frame).toContain("Commands: greet");
      expect(frame).toContain("Agents: review");
      expect(frame).toContain("Skills: triage");
      expect(frame).toContain("MCP servers: calc");
    } finally {
      tree.unmount();
    }
  });

  it("installs a catalog plugin from its details view", async () => {
    const manifestPath = writeMarketplace("alpha-market", [
      {
        name: "hello",
        source: "./plugins/hello",
        version: "1.2.0",
        description: "Hello plugin",
      },
    ]);
    writeKnownMarketplaces({ "alpha-market": manifestPath });
    const sourceDir = writeSourcePlugin("alpha-market", "plugins/hello", {
      name: "hello",
      version: "1.2.0",
      description: "Hello plugin",
      commands: ["./commands"],
    });
    fs.mkdirSync(path.join(sourceDir, "commands"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "commands", "greet.md"), "# greet");

    const tree = render(<PluginsBrowser onCancel={onCancel} />);
    try {
      await tick();
      tree.stdin.write("\t");
      await tick();
      tree.stdin.write("\r");
      await tick();

      expect(tree.lastFrame() ?? "").toContain("Will install:");
      expect(tree.lastFrame() ?? "").toContain(
        "Components are listed after the plugin is installed.",
      );

      tree.stdin.write("i");
      await tick(300);

      const installedRoot = path.join(
        pluginsDir,
        "cache",
        "alpha-market",
        "hello",
        "1.2.0",
      );
      expect(
        fs.existsSync(
          path.join(installedRoot, ".claude-plugin", "plugin.json"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(pluginsDir, "installed_plugins.json")),
      ).toBe(true);
      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("Installed hello@alpha-market 1.2.0");
      expect(frame).toContain("Version: 1.2.0");
      expect(frame).toContain("Commands: greet");
    } finally {
      tree.unmount();
    }
  });

  it("shows enabled, disabled and update-available status cells", async () => {
    const manifestPath = writeMarketplace("alpha-market", [
      { name: "hello", source: "./hello", version: "2.0.0" },
      { name: "steady", source: "./steady", version: "1.0.0" },
      { name: "world", source: "./world", version: "1.0.0" },
    ]);
    writeKnownMarketplaces({ "alpha-market": manifestPath });
    installOnDisk("alpha-market", "hello", "1.0.0");
    installOnDisk("alpha-market", "steady", "1.0.0");
    installOnDisk("alpha-market", "world", "1.0.0");
    writeEnabledPlugins(["hello", "steady"]);

    const tree = render(<PluginsBrowser onCancel={onCancel} />);
    try {
      await tick();
      const frame = tree.lastFrame() ?? "";
      expect(frame).toContain("update available");
      expect(frame).toContain("enabled");
      expect(frame).toContain("disabled");
    } finally {
      tree.unmount();
    }
  });

  it("warns about a partial catalog load and keeps the other marketplaces", async () => {
    const manifestPath = writeMarketplace("alpha-market", [
      { name: "hello", source: "./hello", version: "1.0.0" },
    ]);
    writeKnownMarketplaces({
      "alpha-market": manifestPath,
      "broken-market": path.join(
        pluginsDir,
        "marketplaces",
        "broken-market",
        ".claude-plugin",
        "marketplace.json",
      ),
    });

    const tree = render(<PluginsBrowser onCancel={onCancel} />);
    try {
      await tick();
      expect(tree.lastFrame() ?? "").toContain("Partial catalog load:");
      expect(tree.lastFrame() ?? "").toContain("broken-market");

      tree.stdin.write("\t");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("hello");
    } finally {
      tree.unmount();
    }
  });

  it("filters both the installed and the discover lists by search", async () => {
    const manifestPath = writeMarketplace("alpha-market", [
      { name: "hello", source: "./hello", version: "1.0.0" },
      { name: "world", source: "./world", version: "1.0.0" },
    ]);
    writeKnownMarketplaces({ "alpha-market": manifestPath });
    installOnDisk("alpha-market", "hello", "1.0.0");
    installOnDisk("alpha-market", "world", "1.0.0");

    const tree = render(<PluginsBrowser onCancel={onCancel} />);
    try {
      await tick();
      tree.stdin.write("world");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("world");
      expect(tree.lastFrame() ?? "").not.toContain("hello");

      tree.stdin.write("\t");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("Discover");
      expect(tree.lastFrame() ?? "").toContain("world");
      expect(tree.lastFrame() ?? "").not.toContain("hello");
    } finally {
      tree.unmount();
    }
  });

  it("returns from details to the list and closes from the list", async () => {
    const manifestPath = writeMarketplace("alpha-market", [
      { name: "hello", source: "./hello", version: "1.0.0" },
    ]);
    writeKnownMarketplaces({ "alpha-market": manifestPath });
    installOnDisk("alpha-market", "hello", "1.0.0");

    const tree = render(<PluginsBrowser onCancel={onCancel} />);
    try {
      await tick();
      tree.stdin.write("\r");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("Version: 1.0.0");
      expect(tree.lastFrame() ?? "").toContain("Will install:");

      tree.stdin.write("\x1b");
      await tick();
      expect(tree.lastFrame() ?? "").toContain("Discover");
      expect(tree.lastFrame() ?? "").not.toContain("Version: 1.0.0");
      expect(onCancel).not.toHaveBeenCalled();

      tree.stdin.write("\x1b");
      await tick();
      expect(onCancel).toHaveBeenCalled();
    } finally {
      tree.unmount();
    }
  });
});
