import fs from "fs";
import path from "path";

/**
 * The one spelling a directory is identified by.
 *
 * `path.resolve` normalises `..` and separators but never follows a symlink, and neither
 * does it settle case. A directory therefore has several byte spellings on a real machine:
 * on macOS `getcwd()` answers `/private/var/...` while `TMPDIR` says `/var/...`; on Windows
 * `realpath` may answer with the 8.3 short form (`RUNNER~1`) that the reparse point expands
 * to on the other side. Comparing either spelling directly says "different directory" about
 * one directory.
 *
 * A path that cannot be resolved (a file deleted before the check lands) keeps its resolved
 * form: there is nothing to follow, and the caller's own existence check stays meaningful.
 */
export function canonicalPath(localPath: string): string {
  try {
    return fs.realpathSync.native(path.resolve(localPath));
  } catch {
    return path.resolve(localPath);
  }
}

/** Whether two paths name the same directory, whatever spellings reached them. */
export function sameDirectory(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}
