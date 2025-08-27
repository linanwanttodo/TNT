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

  it("builds the index and then reports it as built", async () => {
    process.chdir(workspace);

    const built = await handleIndex([]);
    expect(built.output).toContain("Codebase index updated");

    // The test config selects no embeddings model, so the status is the
    // full-text variant, which also names the way to enable semantic search.
    const status = await handleIndex(["status"]);
    expect(status.output).toContain("full text only");
    expect(status.output).toContain("transformers.js");

    process.chdir(originalCwd);
  }, 120_000);

  it("answers in the active locale", async () => {
    setLocale("zh-CN");

    const result = await handleIndex(["status"]);

    expect(result.output).toContain("还没有代码库索引");
  }, 30_000);
});
