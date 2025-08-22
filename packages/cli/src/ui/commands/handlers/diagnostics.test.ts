import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLocale, setLocale } from "../../../i18n/index.js";
import { getLspManager } from "../../../lsp/manager.js";
import { handleDiagnostics } from "./diagnostics.js";

const SERVER = path.join(process.cwd(), "test-fixtures", "fake-lsp-server.mjs");

let pluginsDir: string;
let workDir: string;
let previousOverride: string | undefined;
let previousLocale: string;

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

function sampleFile(): string {
  const file = path.join(workDir, "sample.ts");
  fs.writeFileSync(file, "const BAD = 1\n");
  return file;
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-diag-plugins-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-diag-work-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
  previousLocale = getLocale();
  setLocale("en");
});

afterEach(async () => {
  await getLspManager().dispose();
  setLocale(previousLocale as never);
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(pluginsDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("the diagnostics command", () => {
  it("asks for a file when none is given", async () => {
    const result = await handleDiagnostics([]);

    expect(result.output).toContain("Usage: /diagnostics <file>");
  });

  it("reports a file that does not exist", async () => {
    const result = await handleDiagnostics([path.join(workDir, "ghost.ts")]);

    expect(result.output).toContain("No such file");
  });

  it("explains when no plugin declared a language server", async () => {
    const result = await handleDiagnostics([sampleFile()]);

    expect(result.output).toContain("No language server is running");
    expect(result.output).toContain("lspServers");
  });

  it("prints the diagnostics a plugin server publishes", async () => {
    writePlugin();
    const file = sampleFile();

    const result = await handleDiagnostics([file]);

    expect(result.output).toContain("1 diagnostic(s)");
    expect(result.output).toContain("error");
    expect(result.output).toContain(":1:1");
    expect(result.output).toContain("fake diagnostic");
  });

  it("follows the selected locale", async () => {
    writePlugin();
    const file = sampleFile();
    setLocale("zh-CN");

    const result = await handleDiagnostics([file]);

    expect(result.output).toContain("共 1 条诊断");
    expect(result.output).toContain("错误");
  });
});
