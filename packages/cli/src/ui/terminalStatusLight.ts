import { useEffect } from "react";

/**
 * The terminal tab as a status light, the way reference CLIs do it: the title
 * shows the session name prefixed by a ball whose color follows the turn -
 * green while idle, yellow while the model works, red while a permission or
 * quiz waits for the person. Written as an OSC 2 sequence; terminals that do
 * not support titles ignore it.
 */
export type SessionStatus = "idle" | "working" | "waiting";

const GLYPH: Record<SessionStatus, string> = {
  idle: "🟢",
  working: "🟡",
  waiting: "🔴",
};

export function sessionTitle(
  status: SessionStatus,
  sessionName: string,
): string {
  const name = sessionName.trim();
  return `${GLYPH[status]}${name ? ` ${name}` : ""}`;
}

/** Writes the OSC 2 title escape. Kept injectable for tests. */
export function writeTerminalTitle(text: string): void {
  if (!process.stdout.isTTY) {
    return;
  }
  process.stdout.write(`\x1b]2;${text}\x07`);
}

/**
 * Keeps the terminal title in step with the session status. Returns no UI;
 * the title lives outside the Ink frame.
 */
export function useTerminalStatusLight(
  status: SessionStatus,
  sessionName: string,
): void {
  useEffect(() => {
    writeTerminalTitle(sessionTitle(status, sessionName));
    return () => writeTerminalTitle(sessionTitle("idle", sessionName));
  }, [status, sessionName]);
}
