import * as fs from "fs";
import * as path from "path";

/**
 * What a file looked like the last time the model was shown or written it.
 * The write tools refuse to act on a file that has since changed on disk,
 * because the alternative is silently overwriting work done outside TNT - the
 * user's editor, a formatter, a git operation, a background job.
 */
type FileStamp = {
  size: number;
  mtimeMs: number;
  ino: number;
};

const lastSeen = new Map<string, FileStamp | undefined>();

/**
 * The stamp a change was already announced at. Without it every turn of a long
 * task repeats one stale file, and a note that repeats stops being a signal; with
 * it, the same change is mentioned once and a later change is mentioned again.
 */
const announced = new Map<string, FileStamp | undefined>();

function sameStamp(
  a: FileStamp | undefined,
  b: FileStamp | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

function stampOf(filePath: string): FileStamp | undefined {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino };
  } catch {
    return undefined;
  }
}

/**
 * Symlinks and relative paths must not give the same file two records, so every
 * key is the resolved path the read tool used.
 */
function seenKey(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function markFileAsSeen(filePath: string): void {
  const key = seenKey(filePath);
  lastSeen.set(key, stampOf(key));
  // Re-reading is the reset: a change after this point is news again.
  announced.delete(key);
}

export function hasSeenFile(filePath: string): boolean {
  return lastSeen.has(seenKey(filePath));
}

export interface ChangedFile {
  path: string;
  /** The file is gone rather than different. */
  deleted: boolean;
}

/**
 * Files the model was shown that are no longer what it was shown, each reported
 * once per change. Order is by path so the same set of changes produces the same
 * text every run.
 */
export function changedFilesSinceSeen(): ChangedFile[] {
  const changed: ChangedFile[] = [];

  for (const [key, seen] of lastSeen) {
    if (!seen) continue;
    const current = stampOf(key);
    if (sameStamp(current, seen)) continue;
    if (announced.has(key) && sameStamp(announced.get(key), current)) continue;

    announced.set(key, current);
    changed.push({ path: key, deleted: !current });
  }

  return changed.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/**
 * Only positive evidence of a change counts. A file recorded while it was not
 * on disk has no stamp to compare, and refusing then would turn a test fixture
 * or a vanished file into a bogus "someone else edited this" message.
 */
export function changedSinceSeen(filePath: string): boolean {
  const key = seenKey(filePath);
  const seen = lastSeen.get(key);
  if (!seen) return false;
  const current = stampOf(key);
  if (!current) return true;
  return (
    current.size !== seen.size ||
    current.mtimeMs !== seen.mtimeMs ||
    current.ino !== seen.ino
  );
}

export function forgetSeenFiles(): void {
  lastSeen.clear();
  announced.clear();
}
