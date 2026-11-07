import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import { globalDir } from "../config/globalDir.js";
import { resolveWithin } from "../utils/pathGuard.js";

/**
 * Session ids reach the file system. ACP clients send them back in
 * `session/load`, `session/resume` and `session/delete`, so the id is checked
 * before it is joined to a path rather than trusted. The colon is allowed
 * because delegated runs have always used `<parent>:<short>`.
 */
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export class InvalidSessionIdError extends Error {
  constructor(readonly sessionId: string) {
    super(`Invalid session id: ${JSON.stringify(sessionId)}`);
    this.name = "InvalidSessionIdError";
  }
}

export function assertSessionId(sessionId: string): void {
  if (
    !SESSION_ID.test(sessionId) ||
    sessionId === "." ||
    sessionId === ".." ||
    sessionId.includes("/") ||
    sessionId.includes("\\")
  ) {
    throw new InvalidSessionIdError(sessionId);
  }
}

/**
 * The directory name for one session. A plain id is used unchanged; anything
 * that could collide after sanitising gets a short content hash so two ids
 * cannot address the same directory.
 */
export function fsSessionName(sessionId: string): string {
  assertSessionId(sessionId);
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  if (safe === sessionId) return safe;
  const digest = createHash("sha1").update(sessionId).digest("hex").slice(0, 8);
  return `${safe}-${digest}`;
}

/**
 * The directory every session artifact lives under.
 *
 * The root is the operator's own state directory: `TNT_GLOBAL_DIR` when it is
 * set, otherwise `~/.tnt`. That root is trusted - it is chosen explicitly by
 * whoever runs the CLI - so it is the anchor, not the thing to police. What
 * has to stay inside it is everything derived from a session id, and that is
 * what `resolveWithin` enforces at every join below.
 */
export function getSessionDir(): string {
  if (process.env.TNT_TEST && process.env.HOME) {
    // HOME is the operator's environment, so anchoring under it is the same
    // trust decision as anchoring under the global dir.
    const dir = resolveWithin(process.env.HOME, ".tnt/sessions");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  const dir = resolveWithin(globalDir(), "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSessionRoot(sessionId: string): string {
  return resolveWithin(getSessionDir(), fsSessionName(sessionId));
}

export function getTranscriptPath(sessionId: string): string {
  return resolveWithin(getSessionRoot(sessionId), "session.jsonl");
}

export function getSessionMetaPath(sessionId: string): string {
  return resolveWithin(getSessionRoot(sessionId), "meta.json");
}

export function getSessionLeasePath(sessionId: string): string {
  return resolveWithin(getSessionRoot(sessionId), "lock");
}

export function ensureSessionRoot(sessionId: string): string {
  const root = getSessionRoot(sessionId);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

export function getLegacySessionPath(sessionId: string): string {
  assertSessionId(sessionId);
  return resolveWithin(getSessionDir(), `${sessionId}.json`);
}

export function getLegacySessionsListPath(): string {
  return resolveWithin(getSessionDir(), "sessions.json");
}

/** The pre-v2 sidecar layout: `<global>/<kind>/<sanitised-id>`. */
export function getLegacySessionScopedDir(
  kind: string,
  sessionId: string,
): string {
  assertSessionId(sessionId);
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return resolveWithin(path.dirname(getSessionDir()), path.join(kind, safe));
}

export function ensureSessionScopedDir(
  kind: string,
  sessionId: string,
): string {
  const dir = resolveWithin(getSessionRoot(sessionId), kind);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
