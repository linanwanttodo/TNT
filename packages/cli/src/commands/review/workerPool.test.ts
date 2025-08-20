import { ChildProcess, fork } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  killTrackedWorkers,
  trackWorker,
  trackedWorkerCount,
  untrackWorker,
} from "./workerPool.js";

const WORKER = path.join(process.cwd(), "test-fixtures", "fake-worker.mjs");

let workDir: string;
const started: ChildProcess[] = [];

async function waitFor(read: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startWorker(name: string): ChildProcess {
  const pidFile = path.join(workDir, `${name}.pid`);
  const child = fork(WORKER, [pidFile], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  started.push(child);
  return child;
}

async function pidOf(name: string): Promise<number> {
  const pidFile = path.join(workDir, `${name}.pid`);
  await waitFor(() => fs.existsSync(pidFile));
  return Number(fs.readFileSync(pidFile, "utf-8"));
}

/** Runs the handlers a real exit would run, synchronously, as Node does. */
function runExitHandlers(): void {
  for (const listener of process.listeners("exit")) {
    (listener as (code: number) => void)(0);
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-workers-"));
});

afterEach(() => {
  killTrackedWorkers();
  for (const child of started.splice(0)) {
    if (!child.killed) child.kill("SIGKILL");
  }
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("review worker pool", () => {
  it("kills a tracked worker when the process exits", async () => {
    const child = startWorker("tracked");
    trackWorker(child);
    const pid = await pidOf("tracked");
    expect(isAlive(pid)).toBe(true);

    runExitHandlers();
    await waitFor(() => !isAlive(pid));

    expect(isAlive(pid)).toBe(false);
    expect(trackedWorkerCount()).toBe(0);
  });

  it("leaves an untracked worker alone, since its run finished", async () => {
    const child = startWorker("finished");
    trackWorker(child);
    const pid = await pidOf("finished");
    untrackWorker(child);

    runExitHandlers();

    expect(isAlive(pid)).toBe(true);
    expect(trackedWorkerCount()).toBe(0);
  });

  it("reports how many it stopped", () => {
    const child = startWorker("counted");
    trackWorker(child);

    expect(killTrackedWorkers()).toBe(1);
    expect(killTrackedWorkers()).toBe(0);
  });
});
