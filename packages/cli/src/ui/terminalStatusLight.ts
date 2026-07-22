import { useEffect, useRef } from "react";

/** The terminal title only identifies TNT and the current working folder. */
export type SessionStatus = "idle" | "working" | "waiting";
export const TITLE_ANIMATION_INTERVAL_MS = 960;
export const TITLE_MAX_LENGTH = 100;

export function sessionTitle(
  _status: SessionStatus,
  sessionName: string,
  _elapsedMs = 0,
): string {
  const name = sessionName.trim();
  return `TNT${name ? ` ${name}` : ""}`;
}

const TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function writeTerminalTitle(text: string): void {
  if (!process.stdout.isTTY) return;
  const clean = Array.from(text.replace(TITLE_CONTROL_CHARS, "")).slice(
    0,
    TITLE_MAX_LENGTH,
  );
  process.stdout.write(`\x1b]0;${clean.join("")}\x07`);
}

export function useTerminalStatusLight(
  status: SessionStatus,
  sessionName: string,
): void {
  const nameRef = useRef(sessionName);
  nameRef.current = sessionName;

  useEffect(() => {
    writeTerminalTitle(sessionTitle(status, sessionName));
  }, [status, sessionName]);

  useEffect(
    () => () => {
      writeTerminalTitle(sessionTitle("idle", nameRef.current));
    },
    [],
  );
}
