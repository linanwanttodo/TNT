import * as path from "path";

/**
 * Resolve `candidate` against `root` and refuse anything that lands outside
 * it. This is a pure string judgment on the resolved path: it does not follow
 * symbolic links, so a link inside the root that points outside it is not
 * caught here. Callers that need symlink semantics must re-check the result
 * against the filesystem (see permissions/workspacePath.ts).
 *
 * The check exists so a path that reaches an fs call is anchored to a root at
 * resolution time, instead of being resolved against the process cwd and only
 * inspected afterwards.
 */
export function resolveWithin(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Path ${resolved} is outside the allowed root ${resolvedRoot}`,
    );
  }
  return resolved;
}

/**
 * Same judgment under a name that reads as a statement at call sites that do
 * not use the returned path, they only need the containment to hold.
 */
export function assertWithin(root: string, candidate: string): string {
  return resolveWithin(root, candidate);
}
