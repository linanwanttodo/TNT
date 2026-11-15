import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handlePlugins } from "./plugins.js";

const mockState = vi.hoisted(() => ({ officialDir: "" }));

// The fallback test must not clone the official catalogue from GitHub: under
// a concurrent suite the clone is slow enough to fail, which is the flake.
// The mock redirects the auto-add at a local directory fixture instead, so
// the install fails on the name against the same local manifest with no
// network anywhere. Only the fallback test calls ensureDefaultMarketplace;
// the other tests register their marketplaces explicitly.
vi.mock("../../../plugins/discover.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../plugins/discover.js")>();
  const { addMarketplace, createDefaultDeps } =
    await import("../../../plugins/marketplaceManager.js");
  return {
    ...actual,
    ensureDefaultMarketplace: async () => {
      // The real auto-add registers the reserved "claude-plugins-official"
      // name from the official source; a local directory fixture may not
      // claim that name, so it registers under its own instead - the
      // handler logic under test is identical.
      await addMarketplace(
        "fixture-catalogue",
        { source: "directory", path: mockState.officialDir },
        createDefaultDeps(),
      );
      return {
        registered: true,
        message: "Added the default catalogue fixture-catalogue",
      };
    },
  };
});

let cacheDir: string;
let marketDir: string;
let officialDir: string;
let previousOverride: string | undefined;

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-handler-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-handler-market-"));
  officialDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-handler-official-"));
  writeOfficialManifest(officialDir);
  mockState.officialDir = officialDir;
  process.env.TNT_PLUGINS_DIR = cacheDir;
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.rmSync(marketDir, { recursive: true, force: true });
  fs.rmSync(officialDir, { recursive: true, force: true });
});

function writeManifest(dir: string): void {
  const target = path.join(dir, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      name: "local-market",
      owner: { name: "Ops" },
      plugins: [{ name: "formatter", source: "./plugins/formatter" }],
    }),
  );
  const pluginDir = path.join(dir, "plugins", "formatter");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({ name: "formatter", description: "Formats code" }),
  );
}

function writeOfficialManifest(dir: string): void {
  // Stands in for the official catalogue: carries other plugins but never
  // "formatter", so a bare install of it fails on the name exactly as
  // against the real one. Named to dodge the reserved-catalogue guard.
  const target = path.join(dir, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      name: "fixture-catalogue",
      owner: { name: "Anthropic" },
      plugins: [{ name: "other-tool", source: "./plugins/other-tool" }],
    }),
  );
}

describe("plugin slash handler", () => {
  it("opens the browser when called with no arguments", async () => {
    const result = await handlePlugins([]);

    expect(result.openPluginsBrowser).toBe(true);
    expect(result.output).toBeUndefined();
  });

  it("lists installed plugins in text mode for an unknown subcommand", async () => {
    const result = await handlePlugins(["--text"]);

    expect(result.output).toContain("No plugins installed");
    expect(result.output).toContain("/plugin marketplace add");
  });

  it("routes the marketplace subcommand", async () => {
    const empty = await handlePlugins(["marketplace", "list"]);
    expect(empty.output).toBe("No marketplaces registered.");

    writeManifest(marketDir);
    const added = await handlePlugins([
      "marketplace",
      "add",
      "local",
      `directory:${marketDir}`,
    ]);
    expect(added.output).toContain("Added marketplace local");

    const listed = await handlePlugins(["marketplace", "list"]);
    expect(listed.output).toContain("local");
  });

  it("installs a plugin from the single registered marketplace", async () => {
    writeManifest(marketDir);
    await handlePlugins([
      "marketplace",
      "add",
      "local",
      `directory:${marketDir}`,
    ]);

    const installed = await handlePlugins(["install", "formatter"]);

    expect(installed.output).toContain("Installed formatter@local");
    const listed = await handlePlugins(["--text"]);
    expect(listed.output).toContain("formatter");
  });

  it("asks which marketplace when several are registered", async () => {
    writeManifest(marketDir);
    await handlePlugins([
      "marketplace",
      "add",
      "local",
      `directory:${marketDir}`,
    ]);
    const second = path.join(marketDir, "nested");
    writeManifest(second);
    await handlePlugins([
      "marketplace",
      "add",
      "second",
      `directory:${second}`,
    ]);

    const ambiguous = await handlePlugins(["install", "formatter"]);

    expect(ambiguous.output).toContain("Name the marketplace");
    expect(ambiguous.output).toContain("local");
    expect(ambiguous.output).toContain("second");
  });

  it("reports a plugin the marketplace does not declare", async () => {
    writeManifest(marketDir);
    await handlePlugins([
      "marketplace",
      "add",
      "local",
      `directory:${marketDir}`,
    ]);

    const missing = await handlePlugins(["install", "ghost@local"]);

    expect(missing.output).toContain("Could not install ghost@local");
  });

  it("uninstalls a recorded plugin", async () => {
    writeManifest(marketDir);
    await handlePlugins([
      "marketplace",
      "add",
      "local",
      `directory:${marketDir}`,
    ]);
    await handlePlugins(["install", "formatter"]);

    const removed = await handlePlugins(["uninstall", "formatter@local"]);

    expect(removed.output).toContain("Removed formatter@local");
    const again = await handlePlugins(["uninstall", "formatter@local"]);
    expect(again.output).toContain("No installation recorded");
  });

  it("falls back to the official marketplace when installing with none registered", async () => {
    const result = await handlePlugins(["install", "formatter"]);

    // The official catalogue is auto-added; the install then fails on the
    // name, not on the missing marketplace.
    expect(result.output).toContain("Could not install formatter");
    expect(result.output).not.toContain("No marketplaces registered");
  });

  it("counts registered marketplaces next to an empty plugin list", async () => {
    writeManifest(marketDir);
    await handlePlugins([
      "marketplace",
      "add",
      "local",
      `directory:${marketDir}`,
    ]);

    const result = await handlePlugins(["--text"]);

    expect(result.output).toContain("1 marketplace(s) registered");
  });
});
