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

const posixIt = process.platform === "win32" ? it.skip : it;

/** Records the job's own pid and its child's pid, then idles. */
const PARENT_AND_CHILD =
  "const fs=require('fs');const{spawn}=require('child_process');" +
  "const c=spawn(process.execPath,['-e','setInterval(()=>{},1000);']);" +
  "fs.writeFileSync(process.argv[1],String(process.pid)+' '+String(c.pid));" +
  "setInterval(()=>{},1000);";

function pidsOf(pidFile: string): [number, number] {
  const [parent, child] = fs.readFileSync(pidFile, "utf-8").split(" ");
  return [Number(parent), Number(child)];
}

describe("background job process control", () => {
  posixIt(
    "sweeps the processes a job started, not only the job",
    async () => {
      const pidFile = path.join(workDir, "group.pid");
      const job = backgroundJobService.createJob("group sweep");
      const started = backgroundJobService.startJob(job!.id, process.execPath, [
        "-e",
        PARENT_AND_CHILD,
        pidFile,
      ]);
      expect(started).not.toBeNull();
      await waitFor(() => fs.existsSync(pidFile));
      const [, childPid] = pidsOf(pidFile);
      expect(isAlive(childPid)).toBe(true);

      runExitHandlers();
      await waitFor(() => !isAlive(childPid));
      expect(isAlive(childPid)).toBe(false);
    },
    20_000,
  );

  posixIt(
    "cancels a job that ignores SIGTERM",
    async () => {
      const pidFile = path.join(workDir, "trap.pid");
      const job = backgroundJobService.createJob("trapped job");
      const started = backgroundJobService.startJob(job!.id, process.execPath, [
        "-e",
        "process.on('SIGTERM',()=>{});" +
          "require('fs').writeFileSync(process.argv[1],String(process.pid));" +
          "setInterval(()=>{},1000);",
        pidFile,
      ]);
      expect(started).not.toBeNull();
      await waitFor(() => fs.existsSync(pidFile));
      const [pid] = pidsOf(pidFile);

      expect(backgroundJobService.cancelJob(job!.id)).toBe(true);
      // The escalation window is 5s; eight seconds allows for scheduling.
      await waitFor(() => !isAlive(pid), 8_000);
      expect(isAlive(pid)).toBe(false);
    },
    20_000,
  );

  posixIt(
    "cancels the processes a job started",
    async () => {
      const pidFile = path.join(workDir, "cancel-group.pid");
      const job = backgroundJobService.createJob("cancel group");
      const started = backgroundJobService.startJob(job!.id, process.execPath, [
        "-e",
        PARENT_AND_CHILD,
        pidFile,
      ]);
      expect(started).not.toBeNull();
      await waitFor(() => fs.existsSync(pidFile));
      const [, childPid] = pidsOf(pidFile);

      backgroundJobService.cancelJob(job!.id);
      await waitFor(() => !isAlive(childPid));
      expect(isAlive(childPid)).toBe(false);
    },
    20_000,
  );
});
