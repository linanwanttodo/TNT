import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseMarketplaceSource,
  runMarketplaceCommand,
} from "./marketplaceCommand.js";
import { loadKnownMarketplaces } from "./marketplaceRegistry.js";

let cacheDir: string;
let marketDir: string;
let previousOverride: string | undefined;

function writeManifest(dir: string, name = "local-market"): void {
  const target = path.join(dir, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({
      name,
      owner: { name: "Ops" },
      plugins: [
        { name: "formatter", source: "./plugins/formatter" },
        { name: "reviewer", source: "./plugins/reviewer" },
      ],
    }),
  );
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-cmd-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-cmd-market-"));
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

describe("marketplace source parsing", () => {
  it("reads the explicit kind prefixes", () => {
    expect(parseMarketplaceSource("github:acme/tools").source).toEqual({
      source: "github",
      repo: "acme/tools",
    });
    expect(parseMarketplaceSource("npm:@acme/market").source).toEqual({
      source: "npm",
      package: "@acme/market",
    });
    expect(
      parseMarketplaceSource("url:https://example.test/m.json").source,
    ).toEqual({
      source: "url",
      url: "https://example.test/m.json",
    });
    expect(
      parseMarketplaceSource("git:https://git.test/a/b.git").source,
    ).toEqual({
      source: "git",
      url: "https://git.test/a/b.git",
    });
    expect(parseMarketplaceSource("directory:/srv/market").source).toEqual({
      source: "directory",
      path: "/srv/market",
    });
    expect(
      parseMarketplaceSource("file:/srv/market/manifest.json").source,
    ).toEqual({
      source: "file",
      path: "/srv/market/manifest.json",
    });
  });

  it("treats owner/repo as a github source", () => {
    expect(parseMarketplaceSource("acme/tools").source).toEqual({
      source: "github",
      repo: "acme/tools",
    });
  });

  it("treats a bare path as a directory source", () => {
    expect(parseMarketplaceSource("/srv/market").source).toEqual({
      source: "directory",
      path: "/srv/market",
    });
    expect(parseMarketplaceSource("./local").source.source).toBe("directory");
  });

  it("refuses a value it cannot classify", () => {
    expect(() => parseMarketplaceSource("just-a-word")).toThrow(
      /Unrecognized marketplace source/,
    );
  });
});

describe("marketplace commands", () => {
  it("reports an empty registry", async () => {
    const result = await runMarketplaceCommand(["list"]);

    expect(result.output).toBe("No marketplaces registered.");
  });

  it("adds a local marketplace and lists it", async () => {
    writeManifest(marketDir);

    const added = await runMarketplaceCommand([
      "add",
      "local",
      `directory:${marketDir}`,
    ]);
    expect(added.output).toContain("Added marketplace local");
    expect(added.output).toContain("2 plugins");

    const listed = await runMarketplaceCommand(["list"]);
    expect(listed.output).toContain("local");
    expect(listed.output).toContain("directory");
  });

  it("derives a name when only a source is given", async () => {
    writeManifest(marketDir);

    const added = await runMarketplaceCommand([
      "add",
      `directory:${marketDir}`,
    ]);

    expect(added.output).toContain(
      `Added marketplace ${path.basename(marketDir)}`,
    );
  });

  it("reports the failure when a source cannot be fetched", async () => {
    const result = await runMarketplaceCommand([
      "add",
      "missing",
      `directory:${path.join(marketDir, "nope")}`,
    ]);

    expect(result.output).toContain("Could not add marketplace");
    expect(loadKnownMarketplaces().missing).toBeUndefined();
  });

  it("asks for a source when none is given", async () => {
    const result = await runMarketplaceCommand(["add"]);

    expect(result.output).toContain("Usage:");
  });

  it("removes a registered marketplace", async () => {
    writeManifest(marketDir);
    await runMarketplaceCommand(["add", "local", `directory:${marketDir}`]);

    const removed = await runMarketplaceCommand(["remove", "local"]);

    expect(removed.output).toContain("Removed marketplace local");
    expect(loadKnownMarketplaces().local).toBeUndefined();
  });

  it("says so when removing an unknown marketplace", async () => {
    const result = await runMarketplaceCommand(["remove", "ghost"]);

    expect(result.output).toContain("No marketplace named ghost");
  });

  it("lists by default and rejects an unknown action", async () => {
    expect((await runMarketplaceCommand([])).output).toBe(
      "No marketplaces registered.",
    );
    expect((await runMarketplaceCommand(["explode"])).output).toContain(
      "Unknown marketplace action",
    );
  });
});
