import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addMarketplace,
  parseMarketplaceManifest,
} from "./marketplaceManager.js";
import { MarketplaceDeps } from "./marketplaceSources.js";
import { PluginInstallError, installPlugin } from "./pluginInstall.js";

let pluginsDir: string;
let marketDir: string;
let previousOverride: string | undefined;

function deps(overrides: Partial<MarketplaceDeps> = {}): MarketplaceDeps {
  return {
    gitAvailable: () => true,
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

function writeManifest(plugins: unknown[]): void {
  const target = path.join(marketDir, ".claude-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({ name: "team", owner: { name: "Ops" }, plugins }),
  );
}

async function register(): Promise<void> {
  await addMarketplace(
    "team",
    { source: "directory", path: marketDir },
    deps(),
  );
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-src-"));
  marketDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-src-market-"));
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

describe("object-shaped plugin sources", () => {
  it("are accepted by the manifest validator", () => {
    const manifest = parseMarketplaceManifest({
      name: "team",
      owner: { name: "Ops" },
      plugins: [
        { name: "a", source: { source: "npm", package: "acme-plugin" } },
        { name: "b", source: { source: "url", url: "https://git.test/a.git" } },
      ],
    });

    expect(manifest.plugins).toHaveLength(2);
    expect(manifest.plugins[0].source).toEqual({
      source: "npm",
      package: "acme-plugin",
    });
  });

  it("still refuses an entry with no usable source", () => {
    expect(() =>
      parseMarketplaceManifest({
        name: "team",
        owner: { name: "Ops" },
        plugins: [{ name: "a", source: { package: "acme" } }],
      }),
    ).toThrow(/name and a source/);
  });

  it("installs an npm package source", async () => {
    writeManifest([
      { name: "tool", source: { source: "npm", package: "acme-plugin" } },
    ]);
    await register();
    const calls: string[][] = [];

    await installPlugin(
      "team",
      "tool",
      deps({
        async run(file, args) {
          calls.push([file, ...args]);
          if (file === "npm") {
            return {
              code: 0,
              stdout: JSON.stringify([{ filename: "acme-plugin-1.0.0.tgz" }]),
              stderr: "",
            };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
    );

    expect(calls[0][0]).toBe("npm");
    expect(calls[0].slice(1, 3)).toEqual(["pack", "acme-plugin"]);
  });

  it("honours the ref on a github source", async () => {
    writeManifest([
      {
        name: "tool",
        source: { source: "github", repo: "acme/tools", ref: "stable" },
      },
    ]);
    await register();
    const clones: string[][] = [];

    await installPlugin(
      "team",
      "tool",
      deps({
        async run(file, args) {
          if (file === "git" && args[0] === "clone") {
            clones.push(args);
            fs.mkdirSync(args[args.length - 1], { recursive: true });
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
    );

    expect(clones[0]).toContain("--branch");
    expect(clones[0]).toContain("stable");
    expect(clones[0]).toContain("https://github.com/acme/tools.git");
  });

  it("fetches a url source as a git repository", async () => {
    writeManifest([
      {
        name: "tool",
        source: { source: "url", url: "https://git.test/acme/tool.git" },
      },
    ]);
    await register();
    const clones: string[][] = [];

    await installPlugin(
      "team",
      "tool",
      deps({
        async run(file, args) {
          if (file === "git" && args[0] === "clone") {
            clones.push(args);
            fs.mkdirSync(args[args.length - 1], { recursive: true });
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
    );

    expect(clones[0]).toContain("https://git.test/acme/tool.git");
  });

  it("also fetches the url: spelling as git", async () => {
    writeManifest([
      { name: "tool", source: "url:https://git.test/acme/tool.git" },
    ]);
    await register();
    const clones: string[][] = [];

    await installPlugin(
      "team",
      "tool",
      deps({
        async run(file, args) {
          if (file === "git" && args[0] === "clone") {
            clones.push(args);
            fs.mkdirSync(args[args.length - 1], { recursive: true });
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
    );

    expect(clones[0]).toContain("https://git.test/acme/tool.git");
  });

  it("takes the named subdirectory and leaves no clone behind", async () => {
    writeManifest([
      {
        name: "tool",
        source: {
          source: "git-subdir",
          url: "https://git.test/mono.git",
          path: "packages/tool",
        },
      },
    ]);
    await register();

    const installed = await installPlugin(
      "team",
      "tool",
      deps({
        async run(file, args) {
          if (file === "git" && args[0] === "clone") {
            const target = args[args.length - 1];
            fs.mkdirSync(path.join(target, "packages", "tool"), {
              recursive: true,
            });
            fs.writeFileSync(
              path.join(target, "packages", "tool", "plugin.json"),
              JSON.stringify({ name: "tool" }),
            );
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
    );

    expect(fs.existsSync(path.join(installed.installPath, "plugin.json"))).toBe(
      true,
    );
    expect(fs.readdirSync(path.dirname(installed.installPath))).toEqual([
      path.basename(installed.installPath),
    ]);
  });

  it("names a subdirectory the repository does not have", async () => {
    writeManifest([
      {
        name: "tool",
        source: {
          source: "git-subdir",
          url: "https://git.test/mono.git",
          path: "packages/missing",
        },
      },
    ]);
    await register();

    await expect(
      installPlugin(
        "team",
        "tool",
        deps({
          async run(file, args) {
            if (file === "git" && args[0] === "clone") {
              fs.mkdirSync(args[args.length - 1], { recursive: true });
            }
            return { code: 0, stdout: "", stderr: "" };
          },
        }),
      ),
    ).rejects.toThrow(/does not contain/);
  });

  it("refuses a python package source by name", async () => {
    writeManifest([
      { name: "tool", source: { source: "pip", package: "acme" } },
    ]);
    await register();

    await expect(installPlugin("team", "tool", deps())).rejects.toThrow(
      /Python package plugins are not supported/,
    );
  });

  it("refuses an object source it does not know", async () => {
    writeManifest([
      { name: "tool", source: { source: "ftp", url: "ftp://x" } },
    ]);
    await register();

    await expect(installPlugin("team", "tool", deps())).rejects.toThrow(
      PluginInstallError,
    );
  });
});
