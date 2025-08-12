import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAllPlugins } from "./loader.js";
import { loadInstalledPlugins } from "./marketplaceRegistry.js";
import { MarketplaceDeps } from "./marketplaceSources.js";
import {
  PluginInstallError,
  installPlugin,
  uninstallPlugin,
} from "./pluginInstall.js";

let cacheDir: string;
let marketDir: string;
let previousOverride: string | undefined;

function deps(overrides: Partial<MarketplaceDeps> = {}): MarketplaceDeps {
  return {
    gitAvailable: () => false,
    sshConfiguredForGitHub: async () => false,
    async fetchJson() {
      throw new Error("no fetch in these tests");
    },
    async run() {
      return { code: 0, stdout: "", stderr: "" };
    },
    ...overrides,
  };
}

function writeMarketplace(
  declarations: { name: string; source: string; version?: string }[],
): void {
  const target = path.join(marketDir, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      name: "local-market",
      owner: { name: "Ops" },
      plugins: declarations,
    }),
  );
}

function writePluginSource(
  rel: string,
  name: string,
  description?: string,
): string {
  const dir = path.join(marketDir, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({
      name,
      description,
      commands: ["./commands"],
    }),
  );
  fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
  fs.writeFileSync(path.join(dir, "commands", "hello.md"), "Say hello.\n");
  return dir;
}

function registerMarketplace(): void {
  const registryDir = cacheDir;
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, "known_marketplaces.json"),
    JSON.stringify({
      "local-market": {
        source: { source: "directory", path: marketDir },
        installLocation: path.join(
          marketDir,
          ".claude-plugin",
          "marketplace.json",
        ),
        lastUpdated: "2026-01-15T10:30:00.000Z",
      },
    }),
  );
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGIN_CACHE_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-install-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-install-market-"));
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

describe("installing a plugin from a marketplace", () => {
  it("copies a relative plugin source into the cache and records it", async () => {
    writePluginSource("plugins/formatter", "formatter", "Formats code");
    writeMarketplace([
      { name: "formatter", source: "./plugins/formatter", version: "1.2.0" },
    ]);
    registerMarketplace();

    const installed = await installPlugin("local-market", "formatter", deps());

    expect(installed.id).toBe("formatter@local-market");
    expect(installed.version).toBe("1.2.0");
    expect(installed.reused).toBe(false);
    expect(fs.existsSync(path.join(installed.installPath, "plugin.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(installed.installPath, "commands", "hello.md")),
    ).toBe(true);

    const entry = loadInstalledPlugins().plugins["formatter@local-market"];
    expect(entry).toHaveLength(1);
    expect(entry[0].scope).toBe("user");
    expect(entry[0].installPath).toBe(installed.installPath);
    expect(entry[0].installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reuses an installation that is already in place", async () => {
    writePluginSource("plugins/formatter", "formatter");
    writeMarketplace([{ name: "formatter", source: "./plugins/formatter" }]);
    registerMarketplace();

    await installPlugin("local-market", "formatter", deps());
    const again = await installPlugin("local-market", "formatter", deps());

    expect(again.reused).toBe(true);
    expect(
      loadInstalledPlugins().plugins["formatter@local-market"],
    ).toHaveLength(1);
  });

  it("defaults the version when the entry declares none", async () => {
    writePluginSource("plugins/plain", "plain");
    writeMarketplace([{ name: "plain", source: "./plugins/plain" }]);
    registerMarketplace();

    const installed = await installPlugin("local-market", "plain", deps());

    expect(installed.version).toBe("0.0.0");
    expect(installed.installPath.endsWith(path.join("plain", "0.0.0"))).toBe(
      true,
    );
  });

  it("makes the plugin visible to the loader once installed", async () => {
    writePluginSource("plugins/formatter", "formatter", "Formats code");
    writeMarketplace([{ name: "formatter", source: "./plugins/formatter" }]);
    registerMarketplace();

    await installPlugin("local-market", "formatter", deps());

    const discovered = loadAllPlugins().plugins.map((plugin) => plugin.id);
    expect(discovered).toContain("formatter@local-market");
  });

  it("refuses an unknown marketplace", async () => {
    await expect(installPlugin("nope", "formatter", deps())).rejects.toThrow(
      /No marketplace named nope/,
    );
  });

  it("refuses a marketplace whose cache is gone", async () => {
    writeMarketplace([{ name: "formatter", source: "./plugins/formatter" }]);
    registerMarketplace();
    fs.rmSync(path.join(marketDir, ".claude-plugin"), {
      recursive: true,
      force: true,
    });

    await expect(
      installPlugin("local-market", "formatter", deps()),
    ).rejects.toThrow(/not fetched/);
  });

  it("refuses a plugin the marketplace does not declare", async () => {
    writePluginSource("plugins/formatter", "formatter");
    writeMarketplace([{ name: "formatter", source: "./plugins/formatter" }]);
    registerMarketplace();

    await expect(
      installPlugin("local-market", "missing", deps()),
    ).rejects.toThrow(/no plugin named missing/);
  });

  it("refuses a relative source that is absent from the marketplace", async () => {
    writeMarketplace([{ name: "ghost", source: "./plugins/ghost" }]);
    registerMarketplace();

    await expect(
      installPlugin("local-market", "ghost", deps()),
    ).rejects.toThrow(/missing from marketplace/);
  });

  it("names the git requirement for a git source when git is unavailable", async () => {
    writeMarketplace([{ name: "remote", source: "github:acme/tools" }]);
    registerMarketplace();

    await expect(
      installPlugin(
        "local-market",
        "remote",
        deps({ gitAvailable: () => false }),
      ),
    ).rejects.toThrow(/needs git to be installed/);
  });

  it("clones a github plugin and records the commit", async () => {
    writeMarketplace([
      { name: "remote", source: "github:acme/tools", version: "2.0.0" },
    ]);
    registerMarketplace();
    const runs: string[][] = [];
    const gitDeps = deps({
      gitAvailable: () => true,
      sshConfiguredForGitHub: async () => false,
      async run(file, args) {
        runs.push([file, ...args]);
        if (args[0] === "clone") {
          const target = args[args.length - 1];
          fs.mkdirSync(target, { recursive: true });
          fs.writeFileSync(
            path.join(target, "plugin.json"),
            JSON.stringify({ name: "remote" }),
          );
        }
        if (args[0] === "rev-parse") {
          return { code: 0, stdout: "abc123def456\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const installed = await installPlugin("local-market", "remote", gitDeps);

    expect(runs[0][1]).toBe("clone");
    expect(installed.gitCommitSha).toBe("abc123def456");
    expect(
      loadInstalledPlugins().plugins["remote@local-market"][0].gitCommitSha,
    ).toBe("abc123def456");
  });

  it("refuses a source form it cannot resolve instead of guessing", async () => {
    writeMarketplace([
      { name: "weird", source: "url:https://example.test/p.json" },
    ]);
    registerMarketplace();

    await expect(
      installPlugin("local-market", "weird", deps()),
    ).rejects.toThrow(/Unsupported plugin source/);
  });
});

describe("uninstalling a plugin", () => {
  it("drops the registry record and leaves the cache alone", async () => {
    writePluginSource("plugins/formatter", "formatter");
    writeMarketplace([{ name: "formatter", source: "./plugins/formatter" }]);
    registerMarketplace();
    const installed = await installPlugin("local-market", "formatter", deps());

    expect(uninstallPlugin("formatter@local-market")).toBe(1);

    expect(
      loadInstalledPlugins().plugins["formatter@local-market"],
    ).toBeUndefined();
    expect(fs.existsSync(installed.installPath)).toBe(true);
  });

  it("reports nothing removed for an unknown id", () => {
    registerMarketplace();

    expect(uninstallPlugin("ghost@local-market")).toBe(0);
  });
});
