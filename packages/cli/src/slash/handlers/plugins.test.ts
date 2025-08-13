import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handlePlugins } from "./plugins.js";

let cacheDir: string;
let marketDir: string;
let previousOverride: string | undefined;

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGIN_CACHE_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-handler-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-handler-market-"));
  process.env.TNT_PLUGIN_CACHE_DIR = cacheDir;
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGIN_CACHE_DIR;
  } else {
    process.env.TNT_PLUGIN_CACHE_DIR = previousOverride;
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
