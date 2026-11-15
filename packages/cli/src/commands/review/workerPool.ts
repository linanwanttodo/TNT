import { ChildProcess } from "child_process";

const workers = new Set<ChildProcess>();
let exitHookRegistered = false;

function ensureExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  // Registered once for the process: a review worker reaches an orphaned state
  // the moment the parent exits, and several exits bypass the graceful path.
  process.once("exit", () => {
    killTrackedWorkers();
  });
}

export function trackWorker(child: ChildProcess): void {
  ensureExitHook();
  workers.add(child);
}

export function untrackWorker(child: ChildProcess): void {
  workers.delete(child);
}

/** Kills every tracked worker and returns how many were asked to stop. */
export function killTrackedWorkers(): number {
  const count = workers.size;
  for (const child of workers) {
    try {
      child.kill("SIGTERM");
    } catch {
      // A worker that already died needs nothing.
    }
  }
  workers.clear();
  return count;
}

export function trackedWorkerCount(): number {
  return workers.size;
}
