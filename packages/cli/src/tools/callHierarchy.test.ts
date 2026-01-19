import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { callHierarchyTool } from "./callHierarchy.js";

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

function position(direction: "incoming" | "outgoing") {
  return { file_path: file(), line: 5, character: 3, direction };
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-calls-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-calls-work-"));
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

describe("the call hierarchy tool", () => {
  it("is read-only and needs a position and direction", () => {
    expect(callHierarchyTool.readonly).toBe(true);
    expect(callHierarchyTool.isBuiltIn).toBe(true);
    expect(callHierarchyTool.parameters.required).toEqual([
      "file_path",
      "line",
      "character",
      "direction",
    ]);
  });

  it("rejects a direction the protocol does not have", async () => {
    const result = await callHierarchyTool.run({
      ...position("incoming"),
      direction: "sideways",
    });

    expect(result).toContain('"incoming" or "outgoing"');
  });

  it("explains that no language server is configured", async () => {
    const result = await callHierarchyTool.run(position("incoming"));

    expect(result).toContain("No language server is configured");
  });

  it("lists the callers of a symbol", async () => {
    writePlugin();

    const result = await callHierarchyTool.run(position("incoming"));

    expect(result).toContain("knownSymbol (incoming)");
    expect(result).toContain("callerFn");
    expect(result).toContain("caller.ts:3:5");
    expect(result).not.toContain("file:///workspace");
  });

  it("lists what a symbol calls", async () => {
    writePlugin();

    const result = await callHierarchyTool.run(position("outgoing"));

    expect(result).toContain("knownSymbol (outgoing)");
    expect(result).toContain("calleeFn");
    expect(result).toContain("callee.ts:8:3");
  });

  it("reports a missing file", async () => {
    writePlugin();

    const result = await callHierarchyTool.run({
      ...position("incoming"),
      file_path: path.join(workDir, "absent.ts"),
    });

    expect(result).toContain("No such file");
  });
});
