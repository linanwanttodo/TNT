import * as os from "os";
import * as path from "path";

/**
 * The directory this CLI keeps its own state in - settings, sessions, rules,
 * permissions. `TNT_GLOBAL_DIR` is the only name read: the `CONTINUE_` spelling
 * it replaced is retired without a fallback, because the product ships no
 * installed base that a compatibility read would serve.
 */
export function globalDirOverride(): string | undefined {
  return process.env.TNT_GLOBAL_DIR;
}

export function globalDir(home: string = os.homedir()): string {
  return globalDirOverride() || path.join(home, ".tnt");
}
