import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { definitionTool } from "./definition.js";

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
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-def-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-def-work-"));
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

describe("the definition tool", () => {
  it("is read-only and needs a position and kind", () => {
    expect(definitionTool.readonly).toBe(true);
    expect(definitionTool.isBuiltIn).toBe(true);
    expect(definitionTool.parameters.required).toEqual([
      "file_path",
      "line",
      "character",
      "kind",
    ]);
  });

  it("rejects a kind the protocol does not have", async () => {
    const result = await definitionTool.run({
      file_path: file(),
      line: 1,
      character: 1,
      kind: "usage",
    });

    expect(result).toContain('"definition" or "implementation"');
  });

  it("explains that no language server is configured", async () => {
    const result = await definitionTool.run({
      file_path: file(),
      line: 1,
      character: 1,
      kind: "definition",
    });

    expect(result).toContain("No language server is configured");
  });

  it("reports the definition location", async () => {
    writePlugin();

    const result = await definitionTool.run({
      file_path: file(),
      line: 5,
      character: 3,
      kind: "definition",
    });

    expect(result).toContain("1 definition(s)");
    expect(result).toContain("def.ts:2:3");
    expect(result).not.toContain("file:///workspace");
  });

  it("reports the implementation location", async () => {
    writePlugin();

    const result = await definitionTool.run({
      file_path: file(),
      line: 5,
      character: 3,
      kind: "implementation",
    });

    expect(result).toContain("1 implementation(s)");
    expect(result).toContain("impl.ts:4:5");
  });

  it("reports a missing file", async () => {
    writePlugin();

    const result = await definitionTool.run({
      file_path: path.join(workDir, "absent.ts"),
      line: 1,
      character: 1,
      kind: "definition",
    });

    expect(result).toContain("No such file");
  });
});
