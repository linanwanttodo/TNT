import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CommandResult,
  MarketplaceDeps,
  MarketplaceFetchError,
  parseNpmPackFilename,
  resolveMarketplaceSource,
} from "./marketplaceSources.js";
import { KnownMarketplace, MarketplaceSource } from "./marketplaceTypes.js";

let cacheDir: string;
let previousOverride: string | undefined;

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGIN_CACHE_DIR;
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-source-"));
  process.env.TNT_PLUGIN_CACHE_DIR = cacheDir;
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGIN_CACHE_DIR;
  } else {
    process.env.TNT_PLUGIN_CACHE_DIR = previousOverride;
  }
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

interface FakeCall {
  file: string;
  args: string[];
  cwd?: string;
}

function createFakeDeps(
  options: {
    git?: boolean;
    ssh?: boolean;
    results?: Partial<CommandResult>[] | ((call: FakeCall) => CommandResult);
    fetched?: unknown;
    fetchError?: Error;
  } = {},
) {
  const calls: FakeCall[] = [];
  const ok: CommandResult = { code: 0, stdout: "", stderr: "" };
  let index = 0;
  const deps: MarketplaceDeps = {
    gitAvailable: () => options.git ?? true,
    sshConfiguredForGitHub: async () => options.ssh ?? false,
    async fetchJson(url, headers) {
      calls.push({ file: "fetch", args: [url, JSON.stringify(headers)] });
      if (options.fetchError) throw options.fetchError;
      return options.fetched ?? { name: "remote-market" };
    },
    async run(file, args, runOptions) {
      const call: FakeCall = { file, args, cwd: runOptions.cwd };
      calls.push(call);
      if (file === "git" && args[0] === "clone") {
        fs.mkdirSync(path.join(args[args.length - 1], ".git"), {
          recursive: true,
        });
      }
      if (typeof options.results === "function") return options.results(call);
      const scripted = options.results?.[index++];
      return scripted ? { ...ok, ...scripted } : ok;
    },
  };
  return { deps, calls };
}

function checkout(name: string): string {
  return path.join(cacheDir, "marketplaces", name);
}

describe("local marketplace sources", () => {
  it("reads a directory source without running anything", async () => {
    const { deps, calls } = createFakeDeps();
    const source: MarketplaceSource = {
      source: "directory",
      path: "/srv/team-marketplace",
    };

    const resolved = await resolveMarketplaceSource(source, "team", deps);

    expect(resolved.manifestPath).toBe(
      path.join("/srv/team-marketplace", ".claude-plugin", "marketplace.json"),
    );
    expect(resolved.cacheDir).toBe("/srv/team-marketplace");
    expect(calls).toEqual([]);
  });

  it("treats a file source as the manifest itself", async () => {
    const { deps } = createFakeDeps();

    const resolved = await resolveMarketplaceSource(
      { source: "file", path: "/data/market/.claude-plugin/marketplace.json" },
      "team",
      deps,
    );

    expect(resolved.manifestPath).toBe(
      path.resolve("/data/market/.claude-plugin/marketplace.json"),
    );
    // A file source points at .claude-plugin/marketplace.json, so the
    // marketplace root is two levels up.
    expect(resolved.cacheDir).toBe(path.resolve("/data/market"));
  });

  it("caches a url source into the marketplace tree", async () => {
    const { deps, calls } = createFakeDeps({
      fetched: { name: "remote-market", owner: { name: "ops" } },
    });

    const resolved = await resolveMarketplaceSource(
      {
        source: "url",
        url: "https://example.test/marketplace.json",
        headers: { "X-Team": "core" },
      },
      "remote",
      deps,
    );

    expect(resolved.manifestPath).toBe(
      path.join(checkout("remote"), ".claude-plugin", "marketplace.json"),
    );
    expect(JSON.parse(fs.readFileSync(resolved.manifestPath, "utf-8"))).toEqual(
      {
        name: "remote-market",
        owner: { name: "ops" },
      },
    );
    const fetchCall = calls[0];
    expect(fetchCall.args[1]).toContain("TNT-Plugin-Manager");
    expect(fetchCall.args[1]).toContain("core");
  });

  it("skips the network when an unchanged url source is already cached", async () => {
    const { deps, calls } = createFakeDeps();
    const manifest = path.join(
      checkout("remote"),
      ".claude-plugin",
      "marketplace.json",
    );
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, "{}");
    const source: MarketplaceSource = {
      source: "url",
      url: "https://example.test/marketplace.json",
    };
    const existing: KnownMarketplace = {
      source,
      installLocation: manifest,
      lastUpdated: "2026-01-01T00:00:00.000Z",
    };

    const resolved = await resolveMarketplaceSource(
      source,
      "remote",
      deps,
      existing,
    );

    expect(resolved.reused).toBe(true);
    expect(resolved.manifestPath).toBe(manifest);
    expect(calls).toEqual([]);
  });

  it("re-fetches a url source whose recorded location vanished", async () => {
    const { deps } = createFakeDeps();
    const source: MarketplaceSource = {
      source: "url",
      url: "https://example.test/marketplace.json",
    };

    const resolved = await resolveMarketplaceSource(source, "remote", deps, {
      source,
      installLocation: "/gone/nowhere.json",
      lastUpdated: "x",
    });

    expect(resolved.reused).toBe(false);
  });
});

describe("git marketplace sources", () => {
  it("tries the ssh remote first when a key is configured", async () => {
    const { deps, calls } = createFakeDeps({ ssh: true });

    await resolveMarketplaceSource(
      { source: "github", repo: "acme/tools" },
      "acme",
      deps,
    );

    expect(calls[0].args).toContain("git@github.com:acme/tools.git");
  });

  it("prefers https when no ssh key is configured", async () => {
    const { deps, calls } = createFakeDeps({ ssh: false });

    await resolveMarketplaceSource(
      { source: "github", repo: "acme/tools" },
      "acme",
      deps,
    );

    expect(calls[0].args).toContain("https://github.com/acme/tools.git");
  });

  it("falls back to the other protocol when the first clone fails", async () => {
    const { deps, calls } = createFakeDeps({
      ssh: true,
      results: [
        { code: 128, stdout: "", stderr: "Permission denied (publickey)." },
      ],
    });

    await resolveMarketplaceSource(
      { source: "github", repo: "acme/tools" },
      "acme",
      deps,
    );

    expect(calls[0].args).toContain("git@github.com:acme/tools.git");
    expect(calls[1].args).toContain("https://github.com/acme/tools.git");
  });

  it("pulls an existing checkout instead of cloning again", async () => {
    fs.mkdirSync(path.join(checkout("acme"), ".git"), { recursive: true });
    const { deps, calls } = createFakeDeps();

    const resolved = await resolveMarketplaceSource(
      { source: "github", repo: "acme/tools", ref: "stable" },
      "acme",
      deps,
    );

    expect(calls[0].args[0]).toBe("pull");
    expect(calls[0].args).toContain("stable");
    expect(resolved.reused).toBe(true);
  });

  it("replaces a checkout that cannot be updated", async () => {
    fs.mkdirSync(path.join(checkout("team"), ".git"), { recursive: true });
    const { deps, calls } = createFakeDeps({
      results: (call) =>
        call.args[0] === "pull"
          ? { code: 1, stdout: "", stderr: "fatal: not something we can merge" }
          : { code: 0, stdout: "", stderr: "" },
    });

    const resolved = await resolveMarketplaceSource(
      { source: "git", url: "https://git.example.test/team/market.git" },
      "team",
      deps,
    );

    expect(calls.map((call) => call.args[0])).toEqual(["pull", "clone"]);
    expect(resolved.reused).toBe(false);
    expect(fs.existsSync(path.join(checkout("team"), ".git"))).toBe(true);
  });

  it("uses a sparse checkout when the source lists paths", async () => {
    const { deps, calls } = createFakeDeps();

    await resolveMarketplaceSource(
      {
        source: "git",
        url: "https://git.example.test/team/market.git",
        sparsePaths: ["marketplace/.claude-plugin"],
      },
      "team",
      deps,
    );

    expect(calls[0].args).toContain("--no-checkout");
    expect(calls[0].args).toContain("--filter=blob:none");
    expect(calls[1].args.slice(0, 3)).toEqual([
      "sparse-checkout",
      "set",
      "--cone",
    ]);
    expect(calls[2].args).toEqual(["checkout", "HEAD"]);
  });

  it("never prompts for credentials", async () => {
    const { deps } = createFakeDeps();
    const capturedEnv: Record<string, string | undefined>[] = [];
    let runs = 0;
    deps.run = (file, args, options) => {
      runs++;
      capturedEnv.push(options.env as Record<string, string | undefined>);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    await resolveMarketplaceSource(
      { source: "github", repo: "acme/tools" },
      "acme",
      deps,
    );

    expect(runs).toBe(1);
    expect(capturedEnv[0].GIT_TERMINAL_PROMPT).toBe("0");
    expect(capturedEnv[0].GIT_SSH_COMMAND).toContain("BatchMode=yes");
    expect(capturedEnv[0].GIT_SSH_COMMAND).toContain(
      "StrictHostKeyChecking=yes",
    );
  });

  it("refuses a git source when git is missing", async () => {
    const { deps } = createFakeDeps({ git: false });

    await expect(
      resolveMarketplaceSource(
        { source: "github", repo: "acme/tools" },
        "acme",
        deps,
      ),
    ).rejects.toThrow(MarketplaceFetchError);
  });

  it("reports both remotes failing rather than leaving a partial checkout", async () => {
    const { deps } = createFakeDeps({
      ssh: true,
      results: () => ({ code: 128, stdout: "", stderr: "network down" }),
    });

    await expect(
      resolveMarketplaceSource(
        { source: "github", repo: "acme/tools" },
        "acme",
        deps,
      ),
    ).rejects.toThrow(/network down/);
    expect(fs.existsSync(checkout("acme"))).toBe(false);
  });
});

describe("npm marketplace source", () => {
  it("packs and unpacks the tarball into the cache", async () => {
    const { deps, calls } = createFakeDeps({
      results: [
        {
          code: 0,
          stdout: JSON.stringify([{ filename: "acme-market-1.0.0.tgz" }]),
          stderr: "",
        },
        { code: 0, stdout: "", stderr: "" },
      ],
    });

    const resolved = await resolveMarketplaceSource(
      { source: "npm", package: "acme-market" },
      "npm-market",
      deps,
    );

    expect(calls[0].file).toBe("npm");
    expect(calls[0].args.slice(0, 2)).toEqual(["pack", "acme-market"]);
    expect(calls[1].file).toBe("tar");
    expect(resolved.manifestPath).toBe(
      path.join(
        checkout("npm-market"),
        "package",
        ".claude-plugin",
        "marketplace.json",
      ),
    );
  });

  it("cleans the temporary directory after a failed pack", async () => {
    const { deps } = createFakeDeps({
      results: [{ code: 1, stdout: "", stderr: "404 Not Found" }],
    });

    await expect(
      resolveMarketplaceSource(
        { source: "npm", package: "nope" },
        "npm-bad",
        deps,
      ),
    ).rejects.toThrow(/404 Not Found/);
  });

  it("accepts the bare filename that older npm prints", () => {
    expect(parseNpmPackFilename("acme-market-1.0.0.tgz\n")).toBe(
      "acme-market-1.0.0.tgz",
    );
    expect(parseNpmPackFilename('[{"filename":"x.tgz"}]')).toBe("x.tgz");
    expect(parseNpmPackFilename("npm notice\n")).toBeNull();
  });
});
