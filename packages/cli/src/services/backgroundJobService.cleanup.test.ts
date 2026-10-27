import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backgroundJobService } from "./BackgroundJobService.js";

let workDir: string;

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

/** Runs the handlers a real exit would run, synchronously, as Node does. */
function runExitHandlers(): void {
  for (const listener of process.listeners("exit")) {
    (listener as (code: number) => void)(0);
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-bgjobs-"));
});

afterEach(() => {
  backgroundJobService.killAllJobs();
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("background job cleanup on exit", () => {
  it("registers an exit sweep when the service is created", async () => {
    const before = process.listenerCount("exit");
    const module = await import("./BackgroundJobService.js");
    const instance = new module.BackgroundJobService();

    // The singleton already registered for this process, so a second instance
    // must not add another handler.
    expect(instance).toBeInstanceOf(module.BackgroundJobService);
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("kills a running job when the process exits", async () => {
    const pidFile = path.join(workDir, "job.pid");
    const job = backgroundJobService.createJob(
      `${process.execPath} -e writePid ${pidFile}`,
    );
    expect(job).not.toBeNull();
    // A node child that records its own pid, rather than `/bin/sh -c 'echo $$'`:
    // there is no /bin/sh on Windows and no `$$` for cmd.exe, so the job this
    // case is about never started there and the pid file stayed missing.
    const started = backgroundJobService.startJob(job!.id, process.execPath, [
      "-e",
      "require('fs').writeFileSync(process.argv[1], String(process.pid));" +
        " setInterval(() => {}, 1000);",
      pidFile,
    ]);
    expect(started).not.toBeNull();
    await waitFor(() => fs.existsSync(pidFile));
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));
    expect(isAlive(pid)).toBe(true);

    runExitHandlers();
    await waitFor(() => !isAlive(pid));

    expect(isAlive(pid)).toBe(false);
    expect(backgroundJobService.getRunningJobCount()).toBe(0);
  });

  it("survives being swept twice, as a graceful exit followed by the hook does", () => {
    expect(() => {
      backgroundJobService.killAllJobs();
      runExitHandlers();
    }).not.toThrow();
  });
});
