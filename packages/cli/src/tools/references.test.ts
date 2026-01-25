import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { referencesTool } from "./references.js";

const SERVER = path.join(process.cwd(), "test-fixtures", "fake-lsp-server.mjs");

let pluginsDir: string;
let workDir: string;
let previousOverride: string | undefined;

function writePlugin(): void {
  const root = path.join(pluginsDir, "cache", "acme", "voice", "1.0.0");
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "voice",
      lspServers: { fake: { command: process.execPath, args: [SERVER] } },
    }),
  );
}

function file(): string {
  const target = path.join(workDir, "sample.ts");
  fs.writeFileSync(target, "const value = 1\n");
  return target;
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-refs-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-refs-work-"));
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

describe("the references tool", () => {
  it("is read-only and needs a position", () => {
    expect(referencesTool.readonly).toBe(true);
    expect(referencesTool.isBuiltIn).toBe(true);
    expect(referencesTool.parameters.required).toEqual([
      "file_path",
      "line",
      "character",
    ]);
  });

  it("asks for a position counting from 1", async () => {
    expect(
      await referencesTool.run({
        file_path: "a.ts",
        line: 0,
        character: 1,
      }),
    ).toContain("counting from 1");
  });

  it("explains that no language server is configured", async () => {
    const result = await referencesTool.run({
      file_path: file(),
      line: 1,
      character: 1,
    });

    expect(result).toContain("No language server is configured");
  });

  it("lists every reference the server returns", async () => {
    writePlugin();

    const result = await referencesTool.run({
      file_path: file(),
      line: 3,
      character: 5,
    });

    expect(result).toContain("2 reference(s)");
    expect(result).toContain("decl.ts:2:5");
    expect(result).toContain("use.ts:7:3");
    expect(result).not.toContain("file:///workspace");
  });

  it("reports a missing file instead of starting a server for it", async () => {
    writePlugin();

    const result = await referencesTool.run({
      file_path: path.join(workDir, "absent.ts"),
      line: 1,
      character: 1,
    });

    expect(result).toContain("No such file");
  });
});
