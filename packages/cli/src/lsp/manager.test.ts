import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "./manager.js";

const SERVER = path.join(process.cwd(), "test-fixtures", "fake-lsp-server.mjs");

let pluginsDir: string;
let workDir: string;
let previousOverride: string | undefined;

function writePlugin(lspServers: unknown): void {
  const root = path.join(pluginsDir, "cache", "acme", "voice", "1.0.0");
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "voice", lspServers }),
  );
}

function fileToCheck(name = "sample.ts"): string {
  const file = path.join(workDir, name);
  fs.writeFileSync(file, "const a = 1\n");
  return file;
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-lsp-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-lsp-work-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
});

afterEach(async () => {
  await getLspManager().dispose();
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(pluginsDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("starting plugin language servers", () => {
  it("starts a server a plugin declares", async () => {
    writePlugin({ fake: { command: process.execPath, args: [SERVER] } });

    const count = await getLspManager().ensureStarted(workDir);

    expect(count).toBe(1);
    expect(getLspManager().runningServers()).toEqual(["voice-fake"]);
  });

  it("starts nothing when no plugin declares a server", async () => {
    const count = await getLspManager().ensureStarted(workDir);

    expect(count).toBe(0);
    expect(getLspManager().runningServers()).toEqual([]);
  });

  it("skips an entry without a usable command", async () => {
    writePlugin({ broken: { args: ["--nope"] } });

    const count = await getLspManager().ensureStarted(workDir);

    expect(count).toBe(0);
  });

  it("skips a server that cannot start, without throwing", async () => {
    writePlugin({ dead: { command: "definitely-not-a-real-lsp-binary" } });

    const count = await getLspManager().ensureStarted(workDir);

    expect(count).toBe(0);
  });
});

describe("collecting diagnostics", () => {
  it("returns what the server publishes for the file", async () => {
    writePlugin({ fake: { command: process.execPath, args: [SERVER] } });
    await getLspManager().ensureStarted(workDir);

    const diagnostics = await getLspManager().collectDiagnostics(fileToCheck());

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("fake diagnostic");
    expect(diagnostics[0].severity).toBe(1);
  });

  it("returns nothing when no server is running", async () => {
    const diagnostics = await getLspManager().collectDiagnostics(fileToCheck());

    expect(diagnostics).toEqual([]);
  });

  it("returns nothing for a file that does not exist", async () => {
    writePlugin({ fake: { command: process.execPath, args: [SERVER] } });
    await getLspManager().ensureStarted(workDir);

    const diagnostics = await getLspManager().collectDiagnostics(
      path.join(workDir, "missing.ts"),
    );

    expect(diagnostics).toEqual([]);
  });
});
