import * as fs from "fs";
import * as path from "path";

/**
 * The workspace a run belongs to. This is the directory the process was started
 * in, which is what the user sees as the project, and it is resolved once per
 * call so a run that changes directory bounds its writes by the new root.
 */
export function workspaceRoot(): string {
  try {
    return fs.realpathSync(process.cwd());
  } catch {
    // A deleted working directory has no real path; the string is still the
    // best answer about where the run thinks it is.
    return process.cwd();
  }
}

/**
 * ACP can hand a session extra absolute roots. They are workspace for the same
 * run, so the write policy treats them like the primary cwd; the list is
 * process-wide because an ACP worker owns exactly one session.
 */
let additionalRoots: string[] = [];

export function setAdditionalWorkspaceDirectories(
  directories: readonly string[],
): void {
  additionalRoots = directories.map((directory) =>
    resolveExistingPrefix(path.resolve(directory)),
  );
}

export function additionalWorkspaceDirectories(): string[] {
  return [...additionalRoots];
}

/**
 * Resolves a path that may not exist yet, following symlinks as far as the
 * filesystem allows: a link inside the project that points outside it is
 * outside, and a not-yet-created file is measured at its real directory.
 */
function resolveExistingPrefix(target: string): string {
  const missing: string[] = [];
  let cursor = target;
  for (;;) {
    if (fs.existsSync(cursor)) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  try {
    return path.join(fs.realpathSync(cursor), ...missing);
  } catch {
    return cursor;
  }
}

/**
 * True when the path lands inside the workspace. Anything that is not a usable
 * path is treated as outside, because a write whose destination cannot be named
 * is not a write that can be trusted.
 */
export function isWithinWorkspace(filePath: unknown, root?: string): boolean {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return false;
  }
  const resolved = resolveExistingPrefix(path.resolve(filePath));
  const roots = root ? [root] : [workspaceRoot(), ...additionalRoots];
  return roots.some(
    (candidate) =>
      resolved === candidate || resolved.startsWith(candidate + path.sep),
  );
}
