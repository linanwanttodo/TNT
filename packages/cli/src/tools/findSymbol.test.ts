import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { findSymbolTool } from "./findSymbol.js";

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

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-symbol-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-symbol-work-"));
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

describe("the find symbol tool", () => {
  it("is read-only and asks for a query", () => {
    expect(findSymbolTool.readonly).toBe(true);
    expect(findSymbolTool.isBuiltIn).toBe(true);
    expect(findSymbolTool.parameters.required).toEqual(["query"]);
  });

  it("asks for a query when none is given", async () => {
    expect(await findSymbolTool.run({ query: "  " })).toContain("query");
  });

  it("explains that no language server is configured", async () => {
    const result = await findSymbolTool.run({ query: "knownSymbol" });

    expect(result).toContain("No language server is configured");
  });

  it("reports the location a server returns", async () => {
    writePlugin();

    const result = await findSymbolTool.run({ query: "knownSymbol" });

    expect(result).toContain("1 symbol(s)");
    expect(result).toContain("function knownSymbol");
    expect(result).toContain(":5:3");
    expect(result).not.toContain("file:///workspace");
  });

  it("says so when nothing matches", async () => {
    writePlugin();

    const result = await findSymbolTool.run({ query: "absent" });

    expect(result).toContain('No symbol matched "absent"');
  });

  it("answers from the local declaration index when no server is configured", async () => {
    const previousCwd = process.cwd();
    process.chdir(workDir);
    try {
      fs.writeFileSync(
        path.join(workDir, "sample.ts"),
        "export function knownSymbol() {}\n",
      );

      const result = await findSymbolTool.run({ query: "knownSymbol" });

      expect(result).toContain("local tree-sitter declaration index");
      expect(result).toContain("sample.ts:1");
      expect(result).toContain("function_declaration knownSymbol");
      // The miss message must not stand in for the layer's answer.
      expect(result).not.toContain("has no match");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("falls back to the local index when the server has no match", async () => {
    writePlugin();
    const previousCwd = process.cwd();
    process.chdir(workDir);
    try {
      fs.writeFileSync(
        path.join(workDir, "sample.ts"),
        "export function absent() {}\n",
      );

      const result = await findSymbolTool.run({ query: "absent" });

      expect(result).toContain("language server had no match");
      expect(result).toContain("sample.ts:1");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
