import fs from "fs";

import { getSessionMetaPath, getSessionRoot } from "../session/paths.js";

/**
 * Rewrite a stored session's title in its meta.json. The session is not the
 * live one, so the manager never needs to hear about it: the next listing
 * re-reads the file.
 */
export function renameStoredSession(sessionId: string, title: string): void {
  const metaPath = getSessionMetaPath(sessionId);
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<
    string,
    unknown
  >;
  meta.title = title;
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

/** Remove a stored session's directory. False when it was never there. */
export function deleteStoredSession(sessionId: string): boolean {
  const root = getSessionRoot(sessionId);
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  return true;
}
