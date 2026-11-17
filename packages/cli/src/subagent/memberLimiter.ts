/**
 * Bounded concurrency for team member dispatches.
 *
 * The tool planner decides which calls may overlap; this is the second, coarser
 * ceiling that keeps a lead from unpacking a large roster into unbounded
 * parallel work. Waiting is FIFO: a dispatch that arrives while every slot is
 * held waits for the next release rather than being dropped, and a slot is
 * transferred directly to the next waiter so the count can never exceed the
 * limit between a release and a resume.
 *
 * A queued dispatch takes an abort signal: a lead that is cancelled while
 * members are still queued must not leave them parked on the FIFO, where they
 * would wake after a release and settle only when some other member's slot
 * frees up.
 */
export const MAX_CONCURRENT_TEAM_MEMBERS = 8;

let limit = MAX_CONCURRENT_TEAM_MEMBERS;
let active = 0;
const waiters: Array<() => void> = [];

export function getActiveTeamMemberCount(): number {
  return active;
}

export async function acquireTeamMemberSlot(
  /**
   * Fires when the dispatch is cancelled while queued: the waiter leaves the
   * FIFO without taking a slot and the promise rejects, so the caller settles
   * as cancelled instead of running with an already-aborted controller.
   */
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new Error("cancelled by the user while waiting for a member slot");
  }
  if (active < limit) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      reject(
        new Error("cancelled by the user while waiting for a member slot"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.push(waiter);
  });
}

export function releaseTeamMemberSlot(): void {
  const next = waiters.shift();
  if (next) {
    // The slot moves to the waiter; active stays unchanged.
    next();
    return;
  }
  active = Math.max(0, active - 1);
}

export async function withTeamMemberSlot<T>(
  task: () => Promise<T>,
): Promise<T> {
  await acquireTeamMemberSlot();
  try {
    return await task();
  } finally {
    releaseTeamMemberSlot();
  }
}

/** Test seam. Resets the process-wide limiter to a clean state. */
export function resetTeamMemberLimiter(
  nextLimit: number = MAX_CONCURRENT_TEAM_MEMBERS,
): void {
  limit = Math.max(1, nextLimit);
  active = 0;
  waiters.length = 0;
}
