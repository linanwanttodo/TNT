import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLspManager } from "../lsp/manager.js";

import { diagnosticsTool } from "./diagnostics.js";

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

function file(content: string, name = "sample.ts"): string {
  const target = path.join(workDir, name);
  fs.writeFileSync(target, content);
  return target;
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-diagtool-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-diagtool-work-"));
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

describe("the diagnostics tool", () => {
  it("is read-only and built in", () => {
    expect(diagnosticsTool.readonly).toBe(true);
    expect(diagnosticsTool.isBuiltIn).toBe(true);
    expect(diagnosticsTool.parameters.required).toEqual(["file_path"]);
  });

  it("asks for a path when none is given", async () => {
    expect(await diagnosticsTool.run({ file_path: "" })).toContain("file_path");
  });

  it("reports a file that does not exist", async () => {
    const result = await diagnosticsTool.run({
      file_path: path.join(workDir, "ghost.ts"),
    });

    expect(result).toContain("No such file");
  });

  it("explains that no language server is configured", async () => {
    const result = await diagnosticsTool.run({
      file_path: file("const a = 1\n"),
    });

    expect(result).toContain("No language server is configured");
    expect(result).toContain("lspServers");
  });

  it("returns the server diagnostics with a location", async () => {
    writePlugin();
    const target = file("const BAD = 1\n");

    const result = await diagnosticsTool.run({ file_path: target });

    expect(result).toContain("1 diagnostic(s)");
    expect(result).toContain(`${target}:1:1`);
    expect(result).toContain("error");
    expect(result).toContain("fake diagnostic");
  });

  it("says so when the file is clean", async () => {
    writePlugin();
    const target = file("const fine = 1\n");

    const result = await diagnosticsTool.run({ file_path: target });

    expect(result).toContain("No diagnostics for");
  });
});
