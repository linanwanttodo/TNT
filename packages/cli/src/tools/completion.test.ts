import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { completionTool } from "./completion.js";

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
  fs.writeFileSync(target, "const value = obj.\n");
  return target;
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-comp-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-comp-work-"));
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

describe("the completion tool", () => {
  it("is read-only and needs a position", () => {
    expect(completionTool.readonly).toBe(true);
    expect(completionTool.isBuiltIn).toBe(true);
    expect(completionTool.parameters.required).toEqual([
      "file_path",
      "line",
      "character",
    ]);
  });

  it("asks for a path and a one-based position", async () => {
    expect(
      await completionTool.run({ file_path: "", line: 1, character: 1 }),
    ).toContain("file_path");
    expect(
      await completionTool.run({ file_path: file(), line: 0, character: 1 }),
    ).toContain("counting from 1");
  });

  it("reports a file that does not exist", async () => {
    const result = await completionTool.run({
      file_path: path.join(workDir, "ghost.ts"),
      line: 1,
      character: 1,
    });

    expect(result).toContain("No such file");
  });

  it("explains that no language server is configured", async () => {
    const result = await completionTool.run({
      file_path: file(),
      line: 1,
      character: 1,
    });

    expect(result).toContain("No language server is configured");
  });

  it("returns the candidates with their kind and detail", async () => {
    writePlugin();
    const target = file();

    const result = await completionTool.run({
      file_path: target,
      line: 5,
      character: 3,
    });

    expect(result).toContain("3 candidate(s)");
    // The fixture echoes the position it received, proving the mapping.
    expect(result).toContain("candidate at 4:2");
    expect(result).toContain("(method)");
    expect(result).toContain("- fake signature");
    expect(result).toContain("secondCandidate (variable)");
    expect(result).toContain("thirdCandidate (function)");
  });

  it("honours a limit and says how many were left out", async () => {
    writePlugin();

    const result = await completionTool.run({
      file_path: file(),
      line: 1,
      character: 1,
      limit: 2,
    });

    expect(result).toContain("3 candidate(s)");
    expect(result).toContain("secondCandidate");
    expect(result).not.toContain("thirdCandidate");
    expect(result).toContain("1 more not shown");
  });

  it("falls back to the default limit when given an unusable one", async () => {
    writePlugin();

    const result = await completionTool.run({
      file_path: file(),
      line: 1,
      character: 1,
      limit: 0,
    });

    expect(result).toContain("thirdCandidate");
    expect(result).not.toContain("more not shown");
  });
});
