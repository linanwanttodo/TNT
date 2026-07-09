/**
 * Bounded concurrency for team member dispatches.
 *
 * The tool planner decides which calls may overlap; this is the second, coarser
 * ceiling that keeps a lead from unpacking a large roster into unbounded
 * parallel work. Waiting is FIFO: a dispatch that arrives while every slot is
 * held waits for the next release rather than being dropped, and a slot is
 * transferred directly to the next waiter so the count can never exceed the
 * limit between a release and a resume.
 */
export const MAX_CONCURRENT_TEAM_MEMBERS = 8;

let limit = MAX_CONCURRENT_TEAM_MEMBERS;
let active = 0;
const waiters: Array<() => void> = [];

export function getActiveTeamMemberCount(): number {
  return active;
}

export async function acquireTeamMemberSlot(): Promise<void> {
  if (active < limit) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
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
