import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addMarketplace } from "./marketplaceManager.js";
import { loadInstalledPlugins } from "./marketplaceRegistry.js";
import { MarketplaceDeps } from "./marketplaceSources.js";
import {
  PluginInstallError,
  installPluginWithDependencies,
} from "./pluginInstall.js";

let pluginsDir: string;
let marketDir: string;
let secondMarketDir: string;
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

function writePlugin(root: string, name: string): void {
  const dir = path.join(root, "plugins", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, description: name }),
  );
}

function writeManifest(
  root: string,
  name: string,
  plugins: { name: string; dependencies?: string[] }[],
  extra: Record<string, unknown> = {},
): void {
  const target = path.join(root, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      name,
      owner: { name: "Ops" },
      plugins: plugins.map((entry) => ({
        name: entry.name,
        source: `./plugins/${entry.name}`,
        dependencies: entry.dependencies,
      })),
      ...extra,
    }),
  );
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-deps-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-deps-main-"));
  secondMarketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-deps-other-"));
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
  fs.rmSync(secondMarketDir, { recursive: true, force: true });
});

describe("installing with dependencies", () => {
  it("installs a dependency before the plugin that needs it", async () => {
    writePlugin(marketDir, "formatter");
    writePlugin(marketDir, "reviewer");
    writeManifest(marketDir, "team", [
      { name: "formatter" },
      { name: "reviewer", dependencies: ["formatter"] },
    ]);
    await addMarketplace(
      "team",
      { source: "directory", path: marketDir },
      deps(),
    );

    const plan = await installPluginWithDependencies(
      "team",
      "reviewer",
      deps(),
    );

    expect(plan.installed.map((entry) => entry.id)).toEqual([
      "formatter@team",
      "reviewer@team",
    ]);
    expect(Object.keys(loadInstalledPlugins().plugins).sort()).toEqual([
      "formatter@team",
      "reviewer@team",
    ]);
  });

  it("installs a shared dependency once", async () => {
    writePlugin(marketDir, "shared");
    writePlugin(marketDir, "left");
    writePlugin(marketDir, "right");
    writeManifest(marketDir, "team", [
      { name: "shared" },
      { name: "left", dependencies: ["shared"] },
      { name: "right", dependencies: ["shared"] },
    ]);
    await addMarketplace(
      "team",
      { source: "directory", path: marketDir },
      deps(),
    );

    const plan = await installPluginWithDependencies("team", "right", deps());

    expect(plan.installed.map((entry) => entry.id)).toEqual([
      "shared@team",
      "right@team",
    ]);
  });

  it("refuses a dependency cycle instead of looping", async () => {
    writePlugin(marketDir, "first");
    writePlugin(marketDir, "second");
    writeManifest(marketDir, "team", [
      { name: "first", dependencies: ["second"] },
      { name: "second", dependencies: ["first"] },
    ]);
    await addMarketplace(
      "team",
      { source: "directory", path: marketDir },
      deps(),
    );

    await expect(
      installPluginWithDependencies("team", "first", deps()),
    ).rejects.toThrow(/Dependency cycle/);
  });

  it("names a dependency the marketplace does not have", async () => {
    writePlugin(marketDir, "reviewer");
    writeManifest(marketDir, "team", [
      { name: "reviewer", dependencies: ["missing"] },
    ]);
    await addMarketplace(
      "team",
      { source: "directory", path: marketDir },
      deps(),
    );

    await expect(
      installPluginWithDependencies("team", "reviewer", deps()),
    ).rejects.toThrow(/no plugin named missing/);
  });

  it("refuses a dependency in another marketplace by default", async () => {
    writePlugin(marketDir, "reviewer");
    writePlugin(secondMarketDir, "helper");
    writeManifest(secondMarketDir, "other", [{ name: "helper" }]);
    writeManifest(marketDir, "team", [
      { name: "reviewer", dependencies: ["helper@other"] },
    ]);
    await addMarketplace(
      "team",
      { source: "directory", path: marketDir },
      deps(),
    );
    await addMarketplace(
      "other",
      { source: "directory", path: secondMarketDir },
      deps(),
    );

    await expect(
      installPluginWithDependencies("team", "reviewer", deps()),
    ).rejects.toThrow(/does not allow dependencies/);
  });

  it("allows a declared cross-marketplace dependency", async () => {
    writePlugin(marketDir, "reviewer");
    writePlugin(secondMarketDir, "helper");
    writeManifest(secondMarketDir, "other", [{ name: "helper" }]);
    writeManifest(
      marketDir,
      "team",
      [{ name: "reviewer", dependencies: ["helper@other"] }],
      { allowCrossMarketplaceDependenciesOn: ["other"] },
    );
    await addMarketplace(
      "team",
      { source: "directory", path: marketDir },
      deps(),
    );
    await addMarketplace(
      "other",
      { source: "directory", path: secondMarketDir },
      deps(),
    );

    const plan = await installPluginWithDependencies(
      "team",
      "reviewer",
      deps(),
    );

    expect(plan.installed.map((entry) => entry.id)).toEqual([
      "helper@other",
      "reviewer@team",
    ]);
  });

  it("still refuses a marketplace that is not registered", async () => {
    await expect(
      installPluginWithDependencies("ghost", "reviewer", deps()),
    ).rejects.toThrow(PluginInstallError);
  });
});
