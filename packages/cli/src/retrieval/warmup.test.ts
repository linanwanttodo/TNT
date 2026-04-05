import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env } from "../config/env.js";

import { getRetrievalService } from "./service.js";
import { selectsCodebaseProvider, warmRetrieval } from "./warmup.js";

/**
 * The warm-up is a session-start behaviour, so the cases below run against a
 * real workspace and the real config file the global directory holds - the same
 * shape `service.test.ts` uses. Index writes land in the per-worker global
 * directory and go away with it.
 */
const WITH_CODEBASE = `name: warmup-with-codebase
version: 0.0.1
models:
  - name: warmup-chat
    provider: openai
    model: gpt-4
    roles:
      - chat
    apiKey: test
context:
  - provider: codebase
`;

const WITHOUT_CODEBASE = `name: warmup-without-codebase
version: 0.0.1
models:
  - name: warmup-chat
    provider: openai
    model: gpt-4
    roles:
      - chat
    apiKey: test
`;

let workspace: string;
let previousFlag: string | undefined;

function writeConfig(text: string): void {
  fs.mkdirSync(env.continueHome, { recursive: true });
  fs.writeFileSync(path.join(env.continueHome, "config.yaml"), text);
}

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

beforeEach(() => {
  previousFlag = process.env.TNT_WARM_RETRIEVAL;
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-warmup-"));
  fs.writeFileSync(
    path.join(workspace, "warm.ts"),
    "export const warmupMarker = 1;\n",
  );
});

afterEach(() => {
  if (previousFlag === undefined) {
    delete process.env.TNT_WARM_RETRIEVAL;
  } else {
    process.env.TNT_WARM_RETRIEVAL = previousFlag;
  }
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("warming the retrieval index at session start", () => {
  it("reads the workspace config for the codebase provider", async () => {
    writeConfig(WITH_CODEBASE);
    expect(await selectsCodebaseProvider(workspace)).toBe(true);

    writeConfig(WITHOUT_CODEBASE);
    expect(await selectsCodebaseProvider(workspace)).toBe(false);
  }, 120_000);

  it("starts a build the first search then joins", async () => {
    writeConfig(WITH_CODEBASE);

    const started = await warmRetrieval(workspace);

    expect(started).toBe(true);
    // A search that arrives while the build runs joins it rather than starting
    // a second walk of the same directory.
    const service = getRetrievalService(workspace);
    expect(service.isIndexing()).toBe(true);
    expect(await waitFor(async () => !service.isIndexing())).toBe(true);
    expect(await service.hasIndex()).toBe(true);
  }, 120_000);

  it("writes nothing for a workspace that never asked for codebase context", async () => {
    writeConfig(WITHOUT_CODEBASE);

    const started = await warmRetrieval(workspace);

    expect(started).toBe(false);
  }, 120_000);

  it("stays off when the environment says so", async () => {
    writeConfig(WITH_CODEBASE);
    process.env.TNT_WARM_RETRIEVAL = "0";

    expect(await warmRetrieval(workspace)).toBe(false);
  }, 120_000);
});
