import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handlePlugins } from "./plugins.js";

let cacheDir: string;
let marketDir: string;
let previousOverride: string | undefined;

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-handler-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-handler-market-"));
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

describe("plugin slash handler", () => {
  it("points at the marketplace command when nothing is installed", async () => {
    const result = await handlePlugins([]);

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
    const listed = await handlePlugins([]);
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

  it("explains that a marketplace is needed before installing", async () => {
    const result = await handlePlugins(["install", "formatter"]);

    expect(result.output).toContain("No marketplaces registered");
  });

  it("counts registered marketplaces next to an empty plugin list", async () => {
    writeManifest(marketDir);
    await handlePlugins([
      "marketplace",
      "add",
      "local",
      `directory:${marketDir}`,
    ]);

    const result = await handlePlugins([]);

    expect(result.output).toContain("1 marketplace(s) registered");
  });
});
