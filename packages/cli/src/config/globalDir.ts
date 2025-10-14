import * as os from "os";
import * as path from "path";

/**
 * The directory this CLI keeps its own state in - settings, sessions, rules,
 * permissions. `TNT_GLOBAL_DIR` is the name for it.
 *
 * `CONTINUE_GLOBAL_DIR` is still read: it is already written into users' shells,
 * CI configuration and the test harness, and a rename that ignores it does not
 * announce itself - it sends every one of those runs to a fresh empty home and
 * reads like a lost configuration.
 */
export function globalDirOverride(): string | undefined {
  return process.env.TNT_GLOBAL_DIR ?? process.env.CONTINUE_GLOBAL_DIR;
}

export function globalDir(home: string = os.homedir()): string {
  return globalDirOverride() || path.join(home, ".tnt");
}
