import { useEffect, useRef, useState } from "react";

import { claudeGlyphs } from "./symbols.js";

/**
 * Keeps the terminal tab title in step with the turn. Like Claude Code, the
 * title carries one prefix for every state: a static asterisk except while the
 * model works, when it alternates two braille cells. The TNT status itself
 * (idle, working, waiting) still drives the in-frame status UI; only the
 * title's animation is special. Written as OSC 0; terminals that do not
 * support titles ignore it.
 */
export type SessionStatus = "idle" | "working" | "waiting";

/** Claude Code's title alternates once every 960 ms. */
export const TITLE_ANIMATION_INTERVAL_MS = 960;

/** A tab title is a glance, not a transcript: cut a long session name here. */
export const TITLE_MAX_LENGTH = 100;

/**
 * The prefix the title shows `elapsedMs` into a turn. Pure so the cadence can
 * be tested without a clock; an idle title never animates.
 */
export function titlePrefixAt(elapsedMs: number, working: boolean): string {
  const glyphs = claudeGlyphs();
  if (!working) {
    return glyphs.titlePrefix;
  }
  const frames = glyphs.titleFrames;
  const index =
    Math.floor(Math.max(0, elapsedMs) / TITLE_ANIMATION_INTERVAL_MS) %
    frames.length;
  return frames[index] ?? glyphs.titlePrefix;
}

export function sessionTitle(
  status: SessionStatus,
  sessionName: string,
  elapsedMs = 0,
): string {
  const name = sessionName.trim();
  const prefix = titlePrefixAt(elapsedMs, status === "working");
  return `${prefix}${name ? ` ${name}` : ""}`;
}

/**
 * C0 controls and DEL. A title has no use for any of them, and two of them
 * (BEL and ESC) end an OSC string, so a name that carries one injects
 * whatever follows into the terminal.
 */
const TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Writes the OSC 0 title escape. Kept injectable for tests. */
export function writeTerminalTitle(text: string): void {
  if (!process.stdout.isTTY) {
    return;
  }
  const clean = Array.from(text.replace(TITLE_CONTROL_CHARS, "")).slice(
    0,
    TITLE_MAX_LENGTH,
  );
  process.stdout.write(`\x1b]0;${clean.join("")}\x07`);
}

/**
 * Keeps the terminal title in step with the session status. Returns no UI;
 * the title lives outside the Ink frame.
 */
export function useTerminalStatusLight(
  status: SessionStatus,
  sessionName: string,
): void {
  const working = status === "working";
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(0);
    if (!working) {
      return;
    }

    const timer = setInterval(() => {
      setElapsedMs((elapsed) => elapsed + TITLE_ANIMATION_INTERVAL_MS);
    }, TITLE_ANIMATION_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [working]);

  const title = sessionTitle(status, sessionName, elapsedMs);
  useEffect(() => {
    writeTerminalTitle(title);
  }, [title]);

  const nameRef = useRef(sessionName);
  useEffect(() => {
    nameRef.current = sessionName;
  }, [sessionName]);

  useEffect(
    () => () => {
      writeTerminalTitle(sessionTitle("idle", nameRef.current));
    },
    [],
  );
}
