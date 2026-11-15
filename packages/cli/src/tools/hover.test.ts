import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { hoverTool } from "./hover.js";

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
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hover-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-hover-work-"));
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

describe("the hover tool", () => {
  it("is read-only and needs a position", () => {
    expect(hoverTool.readonly).toBe(true);
    expect(hoverTool.isBuiltIn).toBe(true);
    expect(hoverTool.parameters.required).toEqual([
      "file_path",
      "line",
      "character",
    ]);
  });

  it("asks for a path when none is given", async () => {
    const result = await hoverTool.run({
      file_path: "",
      line: 1,
      character: 1,
    });

    expect(result).toContain("file_path");
  });

  it("asks for a one-based position", async () => {
    const result = await hoverTool.run({
      file_path: file(),
      line: 0,
      character: 1,
    });

    expect(result).toContain("counting from 1");
  });

  it("reports a file that does not exist", async () => {
    const result = await hoverTool.run({
      file_path: path.join(workDir, "ghost.ts"),
      line: 1,
      character: 1,
    });

    expect(result).toContain("No such file");
  });

  it("explains that no language server is configured", async () => {
    const result = await hoverTool.run({
      file_path: file(),
      line: 1,
      character: 1,
    });

    expect(result).toContain("No language server is configured");
  });

  it("returns the signature and passes a zero-based position", async () => {
    writePlugin();
    const target = file();

    const result = await hoverTool.run({
      file_path: target,
      line: 5,
      character: 3,
    });

    expect(result).toContain(`${target}:5:3`);
    // The fixture echoes what it received, which proves the mapping.
    expect(result).toContain("hover at 4:2");
  });
});
