import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MarketplaceFetchError,
  MarketplaceDeps,
} from "./marketplaceSources.js";
import {
  MarketplaceManifestError,
  addMarketplace,
  parseMarketplaceManifest,
} from "./marketplaceManager.js";
import { loadKnownMarketplaces } from "./marketplaceRegistry.js";

let cacheDir: string;
let marketDir: string;
let previousOverride: string | undefined;

function writeManifest(dir: string, manifest: unknown): string {
  const target = path.join(dir, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(manifest));
  return target;
}

const validManifest = {
  name: "team-market",
  owner: { name: "Ops", email: "ops@example.test" },
  plugins: [
    { name: "formatter", source: "./plugins/formatter", version: "1.2.0" },
    { name: "reviewer", source: "./plugins/reviewer" },
  ],
};

function gitDepsFor(manifest: unknown) {
  const calls: { file: string; args: string[] }[] = [];
  const deps: MarketplaceDeps = {
    gitAvailable: () => true,
    sshConfiguredForGitHub: async () => false,
    async fetchJson() {
      throw new Error("unused");
    },
    async run(file, args) {
      calls.push({ file, args });
      fs.mkdirSync(path.join(args[args.length - 1], ".claude-plugin"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(args[args.length - 1], ".claude-plugin", "marketplace.json"),
        JSON.stringify(manifest),
      );
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { deps, calls };
}

function noOpsDeps(): MarketplaceDeps {
  return {
    gitAvailable: () => false,
    sshConfiguredForGitHub: async () => false,
    async fetchJson() {
      throw new MarketplaceFetchError("network is not used in these tests");
    },
    async run() {
      throw new MarketplaceFetchError("no command should run in these tests");
    },
  };
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGIN_CACHE_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-manager-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-market-"));
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

describe("marketplace manifest validation", () => {
  it("accepts a well-formed manifest", () => {
    const parsed = parseMarketplaceManifest(validManifest);

    expect(parsed.name).toBe("team-market");
    expect(parsed.owner.name).toBe("Ops");
    expect(parsed.plugins).toHaveLength(2);
    expect(parsed.plugins[0].version).toBe("1.2.0");
  });

  it("rejects a manifest that is not an object", () => {
    for (const bad of [null, undefined, [], "name"]) {
      expect(() => parseMarketplaceManifest(bad)).toThrow(
        MarketplaceManifestError,
      );
    }
  });

  it("rejects a missing name, owner or plugin list", () => {
    expect(() =>
      parseMarketplaceManifest({ ...validManifest, name: "" }),
    ).toThrow(/no name/);
    expect(() =>
      parseMarketplaceManifest({ ...validManifest, owner: {} }),
    ).toThrow(/no owner/);
    expect(() =>
      parseMarketplaceManifest({ ...validManifest, plugins: "formatter" }),
    ).toThrow(/must be a list/);
  });

  it("rejects a plugin entry without a source", () => {
    expect(() =>
      parseMarketplaceManifest({
        ...validManifest,
        plugins: [{ name: "formatter" }],
      }),
    ).toThrow(/name and a source/);
  });

  it("refuses a lookalike of an official catalogue name", () => {
    expect(() =>
      parseMarketplaceManifest({
        ...validManifest,
        name: "official-anthropic",
      }),
    ).toThrow(/impersonates/);
  });

  it("refuses a name that differs from the one demanded", () => {
    expect(() => parseMarketplaceManifest(validManifest, "other")).toThrow(
      /was added as other/,
    );
  });
});

describe("adding a marketplace", () => {
  it("registers a local directory and keeps an absolute manifest location", async () => {
    const manifest = writeManifest(marketDir, validManifest);

    const result = await addMarketplace(
      "team",
      { source: "directory", path: marketDir },
      noOpsDeps(),
    );

    expect(result.manifest.plugins).toHaveLength(2);
    expect(result.reused).toBe(true);
    const recorded = loadKnownMarketplaces().team;
    expect(recorded?.installLocation).toBe(manifest);
    expect(path.isAbsolute(recorded?.installLocation ?? "")).toBe(true);
    expect(recorded?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not register a marketplace whose manifest file is missing", async () => {
    await expect(
      addMarketplace(
        "team",
        { source: "directory", path: marketDir },
        noOpsDeps(),
      ),
    ).rejects.toThrow(/not found/);

    expect(loadKnownMarketplaces().team).toBeUndefined();
  });

  it("does not register a marketplace whose manifest is invalid", async () => {
    writeManifest(marketDir, { name: "team-market" });

    await expect(
      addMarketplace(
        "team",
        { source: "directory", path: marketDir },
        noOpsDeps(),
      ),
    ).rejects.toThrow(/no owner/);

    expect(loadKnownMarketplaces().team).toBeUndefined();
  });

  it("rejects a marketplace name that cannot be a safe path segment", async () => {
    writeManifest(marketDir, validManifest);

    await expect(
      addMarketplace(
        "../escape",
        { source: "directory", path: marketDir },
        noOpsDeps(),
      ),
    ).rejects.toThrow(/Unsafe marketplace name/);
  });

  it("refuses an exact official catalogue name from a non-official source", async () => {
    writeManifest(marketDir, {
      ...validManifest,
      name: "claude-plugins-official",
    });

    await expect(
      addMarketplace(
        "team",
        { source: "directory", path: marketDir },
        noOpsDeps(),
      ),
    ).rejects.toThrow(/only be served from the official organization/);
    expect(loadKnownMarketplaces().team).toBeUndefined();
  });

  it("accepts an exact official catalogue name from the official organization", async () => {
    const { deps, calls } = gitDepsFor({
      name: "claude-plugins-official",
      owner: { name: "Anthropic" },
      plugins: [{ name: "formatter", source: "./plugins/formatter" }],
    });

    const result = await addMarketplace(
      "official",
      { source: "github", repo: "anthropics/claude-plugins-official" },
      deps,
    );

    expect(result.manifest.name).toBe("claude-plugins-official");
    expect(calls[0].args.some((arg) => arg.includes("anthropics/"))).toBe(true);
  });

  it("refuses a github marketplace when git is unavailable", async () => {
    await expect(
      addMarketplace(
        "acme",
        { source: "github", repo: "acme/tools" },
        noOpsDeps(),
      ),
    ).rejects.toThrow(/git is not installed/);
  });
});
