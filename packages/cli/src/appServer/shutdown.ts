/**
 * Wait for the given operations, but never longer than `timeoutMs`. Returns
 * true when they all settled in time and false when the timer won, so the
 * caller can decide how loudly to report the stall. The operations are
 * snapshotted: promises added after the call are not waited on.
 */
export async function settleWithin(
  operations: Iterable<Promise<void>>,
  timeoutMs: number,
): Promise<boolean> {
  const all = Promise.all([...operations]).then(() => true);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([all, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
