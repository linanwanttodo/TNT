import fs from "fs";
import path from "path";

import { logger } from "../utils/logger.js";

const LOCK_WAIT_MS = 2000;
const LOCK_POLL_MS = 25;
const LOCK_STALE_MS = 10_000;

export interface PermissionWriteLockOptions {
  /** How long to wait for a held lock before writing anyway. */
  waitMs?: number;
  /** How often to retry while the lock is held. */
  pollMs?: number;
  /** A lock older than this belongs to a process that is gone. */
  staleMs?: number;
}

async function lockIsStale(
  lockPath: string,
  staleMs: number,
): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    // The holder released it between the failed open and this stat.
    return false;
  }
}

/**
 * Runs fn while holding an exclusive lock file, so two writers appending to
 * the same YAML - a second session, a hook, the TUI and a headless run - queue
 * up instead of each overwriting the other's read-modify-write.
 *
 * Two degraded paths, both logged rather than hidden: a lock older than
 * staleMs is broken instead of waited on forever (whatever created it may be
 * gone), and a wait past waitMs proceeds anyway - refusing to record a
 * permission the user just granted is worse than a rare lost append, and the
 * write itself is atomic either way.
 */
export async function withPermissionWriteLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: PermissionWriteLockOptions = {},
): Promise<T> {
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + waitMs;
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

  let release: (() => Promise<void>) | undefined;
  while (release === undefined) {
    try {
      const handle = await fs.promises.open(lockPath, "wx");
      release = async () => {
        await handle.close().catch(() => {});
        await fs.promises.unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await lockIsStale(lockPath, staleMs)) {
        logger.debug("Breaking a stale permissions lock");
        await fs.promises.unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) {
        logger.debug("Permissions lock waited too long; writing without it");
        release = async () => {};
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  try {
    return await fn();
  } finally {
    await release();
  }
}
