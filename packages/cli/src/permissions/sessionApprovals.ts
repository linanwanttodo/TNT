import * as path from "path";

import { getCurrentSessionId } from "../session/index.js";

// An approval that is kept for the session sits between "once" and "always": the
// human answers once and the same call is not asked again, but nothing is written
// to permissions.yaml and a new session starts clean. The scope is the session id,
// so a resumed or second session cannot inherit a grant it was never shown.
const MAX_SESSIONS = 20;
const MAX_KEYS_PER_SESSION = 500;

const FILE_SCOPED_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

const approvals = new Map<string, Set<string>>();

/**
 * What a "don't ask again this session" answer actually covers, or nothing when
 * the call is not safe to repeat: a Bash grant covers this exact command line, a
 * write grant covers this exact file for this exact tool, and an MCP tool is never
 * cached because its arguments can name anything and the server is not ours to
 * reason about.
 */
export function sessionApprovalKey(
  toolName: string,
  toolArgs: unknown,
): string | undefined {
  if (toolName.startsWith("mcp__")) return undefined;

  const args =
    typeof toolArgs === "object" && toolArgs !== null
      ? (toolArgs as Record<string, unknown>)
      : {};

  if (toolName === "Bash") {
    const command = typeof args.command === "string" ? args.command : "";
    if (command.trim() === "") return undefined;
    // One line, whitespace folded: the same command written with different
    // spacing is the same permission, and a chain is never reduced to its
    // first command (that is what the permanent rule used to do).
    return `Bash(${command.replace(/\s+/g, " ").trim()})`;
  }

  if (FILE_SCOPED_TOOLS.has(toolName)) {
    const target =
      typeof args.filepath === "string"
        ? args.filepath
        : typeof args.file_path === "string"
          ? args.file_path
          : "";
    if (target.trim() === "") return undefined;
    return `${toolName}(${path.resolve(target)})`;
  }

  return undefined;
}

export function rememberSessionApproval(
  toolName: string,
  toolArgs: unknown,
): string | undefined {
  const key = sessionApprovalKey(toolName, toolArgs);
  if (!key) return undefined;

  const session = getCurrentSessionId();
  let stored = approvals.get(session);
  if (!stored) {
    stored = new Set<string>();
    approvals.set(session, stored);
    // The session that was touched longest ago is the one whose grants nobody
    // is going to use again.
    if (approvals.size > MAX_SESSIONS) {
      const oldest = approvals.keys().next().value;
      if (oldest !== undefined && oldest !== session) approvals.delete(oldest);
    }
  }
  if (stored.size >= MAX_KEYS_PER_SESSION) stored.clear();
  stored.add(key);
  // Insertion order matters for the eviction above.
  approvals.delete(session);
  approvals.set(session, stored);
  return key;
}

export function hasSessionApproval(
  toolName: string,
  toolArgs: unknown,
): boolean {
  const key = sessionApprovalKey(toolName, toolArgs);
  if (!key) return false;
  return approvals.get(getCurrentSessionId())?.has(key) === true;
}

export function sessionApprovalKeys(): string[] {
  return [...(approvals.get(getCurrentSessionId()) ?? [])];
}

export function clearSessionApprovals(sessionId?: string): void {
  if (sessionId === undefined) approvals.clear();
  else approvals.delete(sessionId);
}
