import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeTreeWithinBudget } from "../../test-utils/tempTree.js";

import { getLspManager } from "./manager.js";

const SERVER = path.join(process.cwd(), "test-fixtures", "fake-lsp-server.mjs");

let pluginsDir: string;
let workDir: string;
let previousOverride: string | undefined;

function writePlugin(pidFile: string): void {
  const root = path.join(pluginsDir, "cache", "acme", "voice", "1.0.0");
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "voice",
      lspServers: {
        fake: {
          command: process.execPath,
          args: [SERVER, "--pid-file", pidFile],
        },
      },
    }),
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(read: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-lsp-stop-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-lsp-stop-work-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
});

afterEach(async () => {
  await getLspManager().dispose();
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }

  // The server ran with `workDir` as its cwd. Windows keeps that directory
  // locked until it has let go of every handle on the exited child, which is not
  // something the caller can hasten after `dispose()` - so the budget for the
  // retry sits on the whole attempt (see test-utils/tempTree.ts) and a directory
  // the system still owns is named instead of thrown. The two cases above are
  // what this file proves; a leftover temp entry is not a shutdown failure.
  for (const dir of [pluginsDir, workDir]) {
    const leftover = await removeTreeWithinBudget(dir);
    if (leftover) {
      console.warn(
        `language server shutdown cleanup left ${dir}: ${leftover.message}`,
      );
    }
  }
});

describe("language server shutdown", () => {
  it("registers its exit cleanup once, however often it is asked", () => {
    const before = process.listenerCount("exit");

    getLspManager();
    getLspManager();

    expect(process.listenerCount("exit") - before).toBe(1);
  });

  it("kills the server process when the session is over", async () => {
    const pidFile = path.join(workDir, "server.pid");
    writePlugin(pidFile);
    await getLspManager().ensureStarted(workDir);
    await waitFor(() => fs.existsSync(pidFile));
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));
    expect(Number.isInteger(pid)).toBe(true);
    expect(isAlive(pid)).toBe(true);

    getLspManager().stopAllNow();
    await waitFor(() => !isAlive(pid));

    expect(isAlive(pid)).toBe(false);
    expect(getLspManager().runningServers()).toEqual([]);
  });

  it("leaves nothing running to answer later requests", async () => {
    const pidFile = path.join(workDir, "server.pid");
    writePlugin(pidFile);
    await getLspManager().ensureStarted(workDir);
    await waitFor(() => fs.existsSync(pidFile));
    // The pid is read before the stop, and the case waits on it: the server was
    // started with `workDir` as its cwd, and on Windows that directory stays
    // busy for as long as the process is alive, so a cleanup that does not wait
    // spends its whole retry budget on a handle nobody intends to release.
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));

    getLspManager().stopAllNow();
    await waitFor(() => !isAlive(pid));

    expect(await getLspManager().collectDiagnostics(workDir)).toEqual([]);
  });
});
