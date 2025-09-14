import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MarketplaceRegistryError,
  assertInsideCache,
  forgetMarketplace,
  loadInstalledPlugins,
  loadKnownMarketplaces,
  marketplaceCheckoutDir,
  recordPluginInstallation,
  rememberMarketplace,
  removePluginInstallation,
} from "./marketplaceRegistry.js";
import { KnownMarketplace } from "./marketplaceTypes.js";

let cacheDir: string;
let previousOverride: string | undefined;

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-marketplaces-"));
  process.env.TNT_PLUGINS_DIR = cacheDir;
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

const record: KnownMarketplace = {
  source: { source: "directory", path: "/srv/team-marketplace" },
  installLocation: "/plugins/marketplaces/team/.claude-plugin/marketplace.json",
  lastUpdated: "2026-01-15T10:30:00.000Z",
};

describe("known marketplaces registry", () => {
  it("reads an empty registry when the file is absent", () => {
    expect(loadKnownMarketplaces()).toEqual({});
  });

  it("round-trips a marketplace record", () => {
    rememberMarketplace("team", record);

    expect(loadKnownMarketplaces().team).toEqual(record);
    expect(fs.existsSync(path.join(cacheDir, "known_marketplaces.json"))).toBe(
      true,
    );
  });

  it("keeps other records when one marketplace is added", () => {
    rememberMarketplace("team", record);
    rememberMarketplace("personal", {
      ...record,
      installLocation: "/plugins/marketplaces/personal/marketplace.json",
    });

    expect(Object.keys(loadKnownMarketplaces()).sort()).toEqual([
      "personal",
      "team",
    ]);
  });

  it("returns the previous record so a caller can detect a re-add", () => {
    rememberMarketplace("team", record);
    const { previous } = rememberMarketplace("team", record);

    expect(previous?.installLocation).toBe(record.installLocation);
  });

  it("leaves no temporary file behind after a write", () => {
    rememberMarketplace("team", record);

    expect(
      fs.readdirSync(cacheDir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("refuses a name that could escape the cache directory", () => {
    for (const bad of ["../evil", "a/b", "", ".hidden", "spaced name"]) {
      expect(() => rememberMarketplace(bad, record)).toThrow(
        MarketplaceRegistryError,
      );
    }
  });

  it("refuses a relative install location", () => {
    expect(() =>
      rememberMarketplace("team", {
        ...record,
        installLocation: "relative/path.json",
      }),
    ).toThrow(/absolute/);
  });

  it("removes a marketplace and reports whether it was there", () => {
    rememberMarketplace("team", record);

    expect(forgetMarketplace("team")?.installLocation).toBe(
      record.installLocation,
    );
    expect(loadKnownMarketplaces().team).toBeUndefined();
    expect(forgetMarketplace("team")).toBeNull();
  });

  it("reports a corrupted registry with its path", () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, "known_marketplaces.json"),
      "{not json",
    );

    expect(() => loadKnownMarketplaces()).toThrow(
      /Corrupted marketplace registry/,
    );
  });

  it("sanitizes the checkout directory for a cache name", () => {
    expect(marketplaceCheckoutDir("team")).toBe(
      path.join(cacheDir, "marketplaces", "team"),
    );
  });
});

describe("installed plugins registry", () => {
  it("upgrades the legacy single-entry shape to scoped entries", () => {
    fs.writeFileSync(
      path.join(cacheDir, "installed_plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: {
          "formatter@team": {
            version: "1.2.0",
            installedAt: "2026-01-15T10:30:00.000Z",
            installPath: "/plugins/cache/team/formatter/1.2.0",
            gitCommitSha: "abc123",
          },
        },
      }),
    );

    const loaded = loadInstalledPlugins();

    expect(loaded.version).toBe(2);
    expect(loaded.plugins["formatter@team"]).toEqual([
      {
        scope: "user",
        installPath: "/plugins/cache/team/formatter/1.2.0",
        version: "1.2.0",
        installedAt: "2026-01-15T10:30:00.000Z",
        lastUpdated: undefined,
        gitCommitSha: "abc123",
      },
    ]);
  });

  it("replaces only the installation with the same scope and project", () => {
    recordPluginInstallation("formatter@team", {
      scope: "user",
      installPath: "/plugins/cache/team/formatter/1.0.0",
      version: "1.0.0",
    });
    recordPluginInstallation("formatter@team", {
      scope: "project",
      projectPath: "/repo",
      installPath: "/repo/.tnt/plugins/formatter",
      version: "1.0.0",
    });
    recordPluginInstallation("formatter@team", {
      scope: "user",
      installPath: "/plugins/cache/team/formatter/1.1.0",
      version: "1.1.0",
    });

    const entries = loadInstalledPlugins().plugins["formatter@team"];

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.scope).sort()).toEqual([
      "project",
      "user",
    ]);
    expect(
      entries.find((entry) => entry.scope === "user")?.installPath,
    ).toContain("1.1.0");
  });

  it("removes every installation of an id and counts them", () => {
    recordPluginInstallation("formatter@team", {
      scope: "user",
      installPath: "/a",
    });
    recordPluginInstallation("formatter@team", {
      scope: "project",
      projectPath: "/repo",
      installPath: "/b",
    });

    expect(removePluginInstallation("formatter@team")).toBe(2);
    expect(loadInstalledPlugins().plugins["formatter@team"]).toBeUndefined();
    expect(removePluginInstallation("formatter@team")).toBe(0);
  });

  it("refuses an id that is not name@marketplace", () => {
    expect(() =>
      recordPluginInstallation("formatter", {
        scope: "user",
        installPath: "/a",
      }),
    ).toThrow(MarketplaceRegistryError);
    expect(() =>
      recordPluginInstallation("../../evil@team", {
        scope: "user",
        installPath: "/a",
      }),
    ).toThrow(MarketplaceRegistryError);
  });

  it("returns an empty envelope for a missing file", () => {
    expect(loadInstalledPlugins()).toEqual({ version: 2, plugins: {} });
  });
});

describe("cache containment", () => {
  it("refuses a cleanup target outside the cache root", () => {
    const root = path.join(cacheDir, "marketplaces");

    expect(() => assertInsideCache(root, "/etc/passwd")).toThrow(
      MarketplaceRegistryError,
    );
    expect(() =>
      assertInsideCache(root, path.join(root, "team")),
    ).not.toThrow();
    expect(() =>
      assertInsideCache(root, path.join(cacheDir, "somewhere-else")),
    ).toThrow(MarketplaceRegistryError);
  });
});
