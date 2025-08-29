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
  lastSeen.set(seenKey(filePath), stampOf(filePath));
}

export function hasSeenFile(filePath: string): boolean {
  return lastSeen.has(seenKey(filePath));
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
}
