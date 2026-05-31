import * as os from "os";
import * as path from "path";

/**
 * The directory this CLI keeps its own state in - settings, sessions, rules,
 * permissions. `TNT_GLOBAL_DIR` is the only name read: the `CONTINUE_` spelling
 * it replaced is retired without a fallback, because the product ships no
 * installed base that a compatibility read would serve.
 *
 * Trust model: this directory is the operator's own state root. `TNT_GLOBAL_DIR`
 * is set deliberately by whoever runs the CLI, so the value is taken as given
 * and is not constrained further here. What must stay inside it is everything
 * derived from untrusted input - a session id, a file name from a listing -
 * and each of those is anchored with `resolveWithin` at the point it is joined
 * to a path (see `session/paths.ts`).
 */
export function globalDirOverride(): string | undefined {
  return process.env.TNT_GLOBAL_DIR;
}

export function globalDir(home: string = os.homedir()): string {
  return globalDirOverride() || path.join(home, ".tnt");
}
