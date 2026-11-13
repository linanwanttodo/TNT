import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadPluginMcpServers } from "./loaderContributions.js";
import { loadPluginFromDirectory } from "./manifest.js";
import {
  loadInstalledPlugins,
  rememberMarketplace,
} from "./marketplaceRegistry.js";
import type { MarketplaceDeps } from "./marketplaceSources.js";
import { installPlugin } from "./pluginInstall.js";

let root: string;
let previous: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-zip-install-"));
  previous = process.env.TNT_PLUGINS_DIR;
  process.env.TNT_PLUGINS_DIR = path.join(root, "plugins");
});

afterEach(() => {
  if (previous === undefined) delete process.env.TNT_PLUGINS_DIR;
  else process.env.TNT_PLUGINS_DIR = previous;
  fs.rmSync(root, { recursive: true, force: true });
});

async function archive(
  entries: Record<string, string>,
  symlink?: string,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content, { createFolders: false });
  }
  if (symlink) zip.file(symlink, "../outside", { unixPermissions: 0o120777 });
  return zip.generateAsync({ type: "nodebuffer", platform: "UNIX" });
}

function register(
  bytes: Buffer,
  overrides: Record<string, unknown> = {},
): void {
  const manifest = path.join(root, "marketplace.json");
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      name: "zip-market",
      owner: { name: "Fixture" },
      plugins: [
        {
          name: "sample",
          version: "1.2.3",
          source: {
            source: "url",
            type: "zip",
            url: "https://cdn.example.com/plugin.zip",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            path: "sample",
            ...overrides,
          },
        },
      ],
    }),
  );
  rememberMarketplace("zip-market", {
    source: { source: "file", path: manifest },
    installLocation: manifest,
    lastUpdated: "2026-01-01T00:00:00.000Z",
  });
}

function deps(bytes: Buffer, status = 200): MarketplaceDeps {
  return {
    gitAvailable: () => false,
    sshConfiguredForGitHub: async () => false,
    fetchJson: async () => ({}),
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fetchArchive: async () => new Response(new Uint8Array(bytes), { status }),
  };
}

const manifest = JSON.stringify({ name: "sample", version: "1.2.3" });

describe("ZIP plugin installation", () => {
  it("installs the declared subpath without git and records a loadable plugin", async () => {
    const bytes = await archive({
      "sample/.claude-plugin/plugin.json": manifest,
      "sample/skills/helper/SKILL.md":
        "name: helper\ndescription: Test skill\n",
      "sample/.mcp.json": JSON.stringify({
        mcpServers: {
          docs: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"] },
        },
      }),
      "other/ignored.txt": "not part of sample",
    });
    register(bytes);
    const result = await installPlugin("zip-market", "sample", deps(bytes));
    expect(
      fs.readFileSync(
        path.join(result.installPath, "skills/helper/SKILL.md"),
        "utf8",
      ),
    ).toContain("helper");
    expect(fs.existsSync(path.join(result.installPath, "other"))).toBe(false);
    const loaded = loadPluginFromDirectory(result.installPath, "zip-market");
    expect(loaded?.id).toBe("sample@zip-market");
    expect(loadPluginMcpServers([loaded!])).toEqual({
      "sample-docs": {
        command: "node",
        args: [`${result.installPath}/server.js`],
      },
    });
    expect(loadInstalledPlugins().plugins[result.id]).toEqual([
      expect.objectContaining({
        installPath: result.installPath,
        version: "1.2.3",
        scope: "user",
      }),
    ]);
    expect(
      (await installPlugin("zip-market", "sample", deps(bytes))).reused,
    ).toBe(true);
  });

  it("loads ZCode-only manifests and root archives", async () => {
    const bytes = await archive({ ".zcode-plugin/plugin.json": manifest });
    register(bytes, { path: undefined });
    const result = await installPlugin("zip-market", "sample", deps(bytes));
    expect(
      loadPluginFromDirectory(result.installPath, "zip-market")?.name,
    ).toBe("sample");
  });

  it("refuses a hash mismatch without publishing or recording files", async () => {
    const bytes = await archive({ "sample/plugin.json": manifest });
    register(bytes, { sha256: "0".repeat(64) });
    await expect(
      installPlugin("zip-market", "sample", deps(bytes)),
    ).rejects.toThrow(/SHA-256/);
    expect(loadInstalledPlugins().plugins).toEqual({});
    expect(
      fs.existsSync(path.join(root, "plugins/cache/zip-market/sample/1.2.3")),
    ).toBe(false);
  });

  it("reports HTTP failure before extraction", async () => {
    const bytes = await archive({ "sample/plugin.json": manifest });
    register(bytes);
    await expect(
      installPlugin("zip-market", "sample", deps(bytes, 404)),
    ).rejects.toThrow(/404/);
    expect(loadInstalledPlugins().plugins).toEqual({});
  });

  it.each([
    "../outside.txt",
    "/outside.txt",
    "C:/outside.txt",
    "sample/../../outside.txt",
    "sample\\outside.txt",
  ])("rejects unsafe archive entry %s", async (unsafe) => {
    const bytes = await archive({
      "sample/plugin.json": manifest,
      [unsafe]: "unsafe",
    });
    register(bytes);
    await expect(
      installPlugin("zip-market", "sample", deps(bytes)),
    ).rejects.toThrow(/Unsafe/);
    expect(loadInstalledPlugins().plugins).toEqual({});
    expect(fs.existsSync(path.join(root, "outside.txt"))).toBe(false);
  });

  it("rejects archive symlinks", async () => {
    const bytes = await archive(
      { "sample/plugin.json": manifest },
      "sample/link",
    );
    register(bytes);
    await expect(
      installPlugin("zip-market", "sample", deps(bytes)),
    ).rejects.toThrow(/Unsafe/);
  });

  it.each(["../sample", "/sample", "C:/sample"])(
    "rejects unsafe subpath %s",
    async (subpath) => {
      const bytes = await archive({ "sample/plugin.json": manifest });
      register(bytes, { path: subpath });
      await expect(
        installPlugin("zip-market", "sample", deps(bytes)),
      ).rejects.toThrow(/Unsafe/);
    },
  );

  it("refuses a missing or differently named plugin manifest", async () => {
    const bytes = await archive({
      "sample/plugin.json": JSON.stringify({ name: "other" }),
    });
    register(bytes);
    await expect(
      installPlugin("zip-market", "sample", deps(bytes)),
    ).rejects.toThrow(/manifest/);
    expect(loadInstalledPlugins().plugins).toEqual({});
  });

  it("requires HTTPS and a valid checksum for remote code", async () => {
    const bytes = await archive({ "sample/plugin.json": manifest });
    register(bytes, { url: "http://cdn.example.com/plugin.zip" });
    await expect(
      installPlugin("zip-market", "sample", deps(bytes)),
    ).rejects.toThrow(/HTTPS/);
    register(bytes, { sha256: undefined });
    await expect(
      installPlugin("zip-market", "sample", deps(bytes)),
    ).rejects.toThrow(/SHA-256/);
  });
});
