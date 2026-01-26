import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { documentSymbolTool } from "./documentSymbol.js";

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
  fs.writeFileSync(target, "class Greeter {\n  greet() {}\n}\n");
  return target;
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-outline-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-outline-work-"));
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

describe("the document symbol tool", () => {
  it("is read-only and needs a file", () => {
    expect(documentSymbolTool.readonly).toBe(true);
    expect(documentSymbolTool.isBuiltIn).toBe(true);
    expect(documentSymbolTool.parameters.required).toEqual(["file_path"]);
  });

  it("explains that no language server is configured", async () => {
    const result = await documentSymbolTool.run({ file_path: file() });

    expect(result).toContain("No language server is configured");
  });

  it("reports a missing file", async () => {
    writePlugin();

    const result = await documentSymbolTool.run({
      file_path: path.join(workDir, "absent.ts"),
    });

    expect(result).toContain("No such file");
  });

  it("renders the outline with nesting and 1-based positions", async () => {
    writePlugin();

    const result = await documentSymbolTool.run({ file_path: file() });

    expect(result).toContain("2 symbol(s)");
    expect(result).toContain("class Greeter 1:7");
    expect(result).toContain("  method greet 2:3");
  });
});
