import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../../config/env.js";
import { getLocale, setLocale } from "../../../i18n/index.js";

import { handleIndex } from "./codebaseIndex.js";

/**
 * The command works on the current working directory, which is how the CLI
 * defines a workspace, so the suite moves into a temp workspace and back. The
 * config and the index database land in the per-worker global directory.
 */
let workspace: string;
const originalCwd = process.cwd();
const originalLocale = getLocale();

const CONFIG = `name: index-command-test
version: 0.0.1
models:
  - name: test-chat
    provider: openai
    model: gpt-4
    roles:
      - chat
    apiKey: test
context:
  - provider: codebase
`;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-index-cmd-"));
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "src", "first.ts"),
    "export const commandMarker = 1;\n",
  );
  fs.writeFileSync(path.join(env.continueHome, "config.yaml"), CONFIG);
});

afterAll(() => {
  process.chdir(originalCwd);
  setLocale(originalLocale);
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("the /index command", () => {
  it("refuses an unknown subcommand", async () => {
    const result = await handleIndex(["wat"]);

    expect(result.output).toContain("/index [status]");
  });

  it("reports that no index exists yet", async () => {
    const result = await handleIndex(["status"]);

    expect(result.output).toContain("No codebase index");
  });

  it("starts the build and reports progress until it lands", async () => {
    process.chdir(workspace);
    try {
      const started = await handleIndex([]);
      expect(started.output).toContain("background");

      // Still running: the status reports the live build rather than the
      // "no index" message it showed before the build was started.
      const running = await handleIndex(["status"]);
      const runningOutput = running.output ?? "";
      expect(runningOutput).not.toContain("No codebase index");
      expect(runningOutput).not.toContain("还没有代码库索引");

      // Poll the status the way a user would; the build runs in the
      // background and the command never blocks on it.
      const landed = await waitFor(async () => {
        const status = await handleIndex(["status"]);
        const output = status.output ?? "";
        return output.includes("full text only") || output.includes("is built");
      });

      // The test config selects no embeddings model, so the final status is
      // the full-text variant, which also names the way to enable semantic
      // search.
      const status = await handleIndex(["status"]);
      const finalOutput = status.output ?? "";
      expect(landed).toBe(true);
      expect(finalOutput).toContain("full text only");
      expect(finalOutput).toContain("transformers.js");
    } finally {
      process.chdir(originalCwd);
    }
  }, 120_000);

  it("answers in the active locale", async () => {
    setLocale("zh-CN");

    const result = await handleIndex(["status"]);

    expect(result.output).toMatch(/代码库索引|正在索引/);
  }, 30_000);
});

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
