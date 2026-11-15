import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

/**
 * Writes a file in one step: a reader sees either the previous contents or the
 * new ones, never a half-written file.
 *
 * The files this is used for are the ones the CLI cannot recover from being
 * truncated: a session is the only copy of a conversation, the global context
 * holds settings that are read back at startup, the config file decides which
 * model the CLI will use, and the edit tools rewrite the user's source. A plain
 * write interrupted by a crash or a full disk leaves a file that fails to
 * parse, and the readers that skip what they cannot parse do so without saying
 * anything.
 *
 * Because the write ends in a rename, the destination must be a real path:
 * renaming onto a symlink would replace the link itself with a regular file,
 * where a plain write would have followed it. The file's mode is carried over
 * to the replacement for the same reason: the rename would otherwise hand the
 * file the default mode, and replacing a 0600 file would silently widen it.
 */
export function writeFileAtomically(filePath: string, contents: string): void {
  const realPath = resolveToRealPath(filePath);
  const temporaryPath = `${realPath}.${randomUUID()}.tmp`;

  let mode: number | undefined;
  try {
    mode = fs.statSync(realPath).mode & 0o777;
  } catch {
    // A new file has no mode to carry over.
  }

  try {
    fs.writeFileSync(
      temporaryPath,
      contents,
      mode !== undefined ? { mode } : undefined,
    );
    if (mode !== undefined) {
      try {
        // Filesystems that reject chmod must not fail the write; the file was
        // already created with the closest mode umask allows.
        fs.chmodSync(temporaryPath, mode);
      } catch {
        // Keep the mode the temporary file was created with.
      }
    }
    fs.renameSync(temporaryPath, realPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // The original error is the one worth reporting.
    }
    throw error;
  }
}

function resolveToRealPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    // The file may not exist yet. Resolve the directory instead so a symlinked
    // parent directory still lands the write in the real location.
    try {
      return path.join(
        fs.realpathSync(path.dirname(filePath)),
        path.basename(filePath),
      );
    } catch {
      return filePath;
    }
  }
}
