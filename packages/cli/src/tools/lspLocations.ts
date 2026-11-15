import path from "path";
import { fileURLToPath } from "url";

import { toDisplayPath } from "../utils/displayPath.js";

/**
 * A server may answer with a file URI or an opaque scheme; show both readably.
 *
 * The URI's own path is the fallback, not a last-resort dump of the scheme:
 * `fileURLToPath` re-bases a URI that is not under the current drive onto `C:\`
 * on Windows, so a server answering with `/workspace/src/a.ts` from a temp
 * workspace produced a `..\..\workspace\src\a.ts` that points at nothing the
 * reader can open. When the conversion does not land inside the workspace, the
 * server's spelling is the honest one.
 */
export function describeLspUri(uri: string | undefined): string {
  if (!uri) {
    return "?";
  }
  if (!uri.startsWith("file://")) {
    return uri;
  }

  const underCwd = ((): string | null => {
    try {
      const local = path.relative(process.cwd(), fileURLToPath(uri));
      return local && !local.startsWith("..") ? local : null;
    } catch {
      return null;
    }
  })();

  if (underCwd) {
    return toDisplayPath(underCwd);
  }

  try {
    // Without a host, `pathname` is the path the server meant.
    return toDisplayPath(new URL(uri).pathname) || "/";
  } catch {
    return uri;
  }
}
