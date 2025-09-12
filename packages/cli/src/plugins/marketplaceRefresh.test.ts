import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAllPlugins } from "./loader.js";
import { addMarketplace, refreshMarketplace } from "./marketplaceManager.js";
import { loadInstalledPlugins } from "./marketplaceRegistry.js";
import type { MarketplaceDeps } from "./marketplaceSources.js";
import { installPlugin } from "./pluginInstall.js";

let pluginsDir: string;
let marketDir: string;
let previousOverride: string | undefined;

function deps(): MarketplaceDeps {
  return {
    gitAvailable: () => false,
    sshConfiguredForGitHub: async () => false,
    async fetchJson() {
      throw new Error("no fetch in these tests");
    },
    async run() {
      throw new Error("no command in these tests");
    },
  };
}

function writePluginSource(name: string, version: string): void {
  const dir = path.join(marketDir, "plugins", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version, description: `${name} ${version}` }),
  );
}

function writeManifest(
  plugins: { name: string; version: string }[],
  marketplaceName = "team-market",
): void {
  const target = path.join(marketDir, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      name: marketplaceName,
      owner: { name: "Ops" },
      plugins: plugins.map((entry) => ({
        name: entry.name,
        version: entry.version,
        source: `./plugins/${entry.name}`,
      })),
    }),
  );
}

async function addAndInstall(version = "1.0.0"): Promise<void> {
  writePluginSource("formatter", version);
  writeManifest([{ name: "formatter", version }]);
  await addMarketplace(
    "team",
    { source: "directory", path: marketDir },
    deps(),
  );
  await installPlugin("team", "formatter", deps());
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-refresh-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-refresh-market-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(pluginsDir, { recursive: true, force: true });
  fs.rmSync(marketDir, { recursive: true, force: true });
});

describe("refreshing a marketplace", () => {
  it("reports what changed and updates an installed plugin", async () => {
    await addAndInstall("1.0.0");
    writePluginSource("reviewer", "1.0.0");
    writePluginSource("formatter", "2.0.0");
    writeManifest([
      { name: "formatter", version: "2.0.0" },
      { name: "reviewer", version: "1.0.0" },
    ]);

    const summary = await refreshMarketplace("team", deps());

    expect(summary.changed).toBe(true);
    expect(summary.updatedPlugins).toEqual([
      { id: "formatter@team", from: "1.0.0", to: "2.0.0" },
    ]);
    expect(summary.failed).toEqual([]);
  });

  it("points the install record at the new version and discovers it", async () => {
    await addAndInstall("1.0.0");
    writePluginSource("formatter", "2.0.0");
    writeManifest([{ name: "formatter", version: "2.0.0" }]);

    await refreshMarketplace("team", deps());

    const record = loadInstalledPlugins().plugins["formatter@team"][0];
    expect(record.version).toBe("2.0.0");
    expect(record.installPath.endsWith(path.join("formatter", "2.0.0"))).toBe(
      true,
    );
    const discovered = loadAllPlugins().plugins.find(
      (plugin) => plugin.id === "formatter@team",
    );
    expect(discovered?.path.endsWith(path.join("formatter", "2.0.0"))).toBe(
      true,
    );
  });

  it("leaves a plugin alone when its version did not move", async () => {
    await addAndInstall("1.0.0");

    const summary = await refreshMarketplace("team", deps());

    expect(summary.updatedPlugins).toEqual([]);
    expect(loadInstalledPlugins().plugins["formatter@team"]).toHaveLength(1);
  });

  it("reports a change without touching an install whose plugin disappeared", async () => {
    await addAndInstall("1.0.0");
    writeManifest([]);

    const summary = await refreshMarketplace("team", deps());

    expect(summary.changed).toBe(true);
    expect(summary.updatedPlugins).toEqual([]);
    expect(loadInstalledPlugins().plugins["formatter@team"]).toHaveLength(1);
  });

  it("reports no change when the manifest is the one already recorded", async () => {
    await addAndInstall("1.0.0");

    const summary = await refreshMarketplace("team", deps());

    expect(summary.changed).toBe(false);
  });

  it("can check for changes without updating anything", async () => {
    await addAndInstall("1.0.0");
    writePluginSource("formatter", "2.0.0");
    writeManifest([{ name: "formatter", version: "2.0.0" }]);

    const summary = await refreshMarketplace("team", deps(), {
      updatePlugins: false,
    });

    expect(summary.changed).toBe(true);
    expect(summary.updatedPlugins).toEqual([]);
    expect(loadInstalledPlugins().plugins["formatter@team"][0].version).toBe(
      "1.0.0",
    );
  });

  it("refuses an unknown marketplace", async () => {
    await expect(refreshMarketplace("ghost", deps())).rejects.toThrow(
      /No marketplace named ghost/,
    );
  });

  it("updates a plugin only from the marketplace it came from", async () => {
    await addAndInstall("1.0.0");

    // A second marketplace publishes the same name at a much newer version. The
    // install id carries its marketplace (`formatter@team`), and that is what
    // decides whose version an installed plugin follows - otherwise any
    // catalogue could take over an install by reusing a name.
    const otherDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-refresh-other-"),
    );
    try {
      const pluginDir = path.join(otherDir, "plugins", "formatter");
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify({
          name: "formatter",
          version: "9.9.9",
          description: "same name, another catalogue",
        }),
      );
      const manifest = path.join(
        otherDir,
        ".claude-plugin",
        "marketplace.json",
      );
      fs.mkdirSync(path.dirname(manifest), { recursive: true });
      fs.writeFileSync(
        manifest,
        JSON.stringify({
          name: "other-market",
          owner: { name: "Other" },
          plugins: [
            {
              name: "formatter",
              version: "9.9.9",
              source: "./plugins/formatter",
            },
          ],
        }),
      );
      await addMarketplace(
        "other",
        { source: "directory", path: otherDir },
        deps(),
      );

      const summary = await refreshMarketplace("other", deps());

      expect(summary.updatedPlugins).toEqual([]);
      expect(summary.failed).toEqual([]);
      expect(loadInstalledPlugins().plugins["formatter@team"][0].version).toBe(
        "1.0.0",
      );
      expect(loadInstalledPlugins().plugins["formatter@other"]).toBeUndefined();
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
