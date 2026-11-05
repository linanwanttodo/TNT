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

/**
 * C0 controls and DEL. A title has no use for any of them, and two of them
 * (BEL and ESC) end an OSC string, so a name that carries one injects
 * whatever follows into the terminal.
 */
const TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Writes the OSC 2 title escape. Kept injectable for tests. */
export function writeTerminalTitle(text: string): void {
  if (!process.stdout.isTTY) {
    return;
  }
  process.stdout.write(`\x1b]2;${text.replace(TITLE_CONTROL_CHARS, "")}\x07`);
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
