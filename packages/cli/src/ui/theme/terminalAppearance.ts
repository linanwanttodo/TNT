/**
 * Terminal appearance detection for the auto theme.
 *
 * Two signals, cheapest first: the `COLORFGBG` environment variable reports
 * the terminal's foreground/background palette slots without any I/O, and the
 * OSC 11 query asks the terminal itself for its background colour. The OSC
 * answer needs raw mode to arrive at all (canonical input would sit in the
 * line buffer forever), so the probe enables it for the one write and hands
 * the terminal back the way it found it. A terminal that answers neither
 * falls back to dark, which is the default theme.
 */

import fs from "fs";

import { themeFileFor, type ThemeName } from "./tokens.js";

const OSC_BACKGROUND_QUERY = "\x1b]11;?\x1b\\";
const OSC_RESPONSE_TIMEOUT_MS = 250;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface ProbeStreams {
  /** Anything with the slice of a TTY's stdin the probe reads: data events,
   * raw-mode toggling, and the isTTY flag. */
  stdin: NodeJS.EventEmitter & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  /** Anything that accepts the query write; only `write` is used. */
  stdout: { write: (data: string) => unknown };
}

/**
 * Parses an OSC 11 answer: `ESC]11;rgb:rrrr/gggg/bbbb` terminated by ST or
 * BEL. Components come back as one to four hex digits per channel.
 */
export function parseOsc11Color(chunk: string): Rgb | undefined {
  const match = chunk.match(
    /\x1b\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})/,
  );
  if (!match) {
    return undefined;
  }

  const channel = (hex: string): number => {
    const value = parseInt(hex, 16);
    const max = 16 ** hex.length - 1;
    return Math.round((value / max) * 255);
  };

  return {
    r: channel(match[1]!),
    g: channel(match[2]!),
    b: channel(match[3]!),
  };
}

/** Perceptual brightness on a 0-255 scale; enough to tell dark from light. */
export function perceivedBrightness({ r, g, b }: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The `COLORFGBG` heuristic (`fg;bg`): slots 0-6 and 8 are dark backgrounds,
 * 7 and 9-15 are light. Returns undefined when the variable is absent or
 * malformed.
 */
export function colorfgbgIsDark(
  value: string | undefined,
): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value.split(";");
  const bg = Number(parts[parts.length - 1]);
  if (!Number.isFinite(bg)) {
    return undefined;
  }
  return bg <= 6 || bg === 8;
}

/**
 * One-shot detection of whether the terminal background is dark. Answers from
 * `COLORFGBG` when present, otherwise asks the terminal over OSC 11 and
 * falls back to dark when nothing answers in time.
 */
export async function probeTerminalIsDark(
  io: ProbeStreams,
  timeoutMs = OSC_RESPONSE_TIMEOUT_MS,
): Promise<boolean> {
  const fromEnv = colorfgbgIsDark(process.env.COLORFGBG);
  if (fromEnv !== undefined) {
    return fromEnv;
  }

  return new Promise((resolve) => {
    let settled = false;
    let wasRaw = false;

    const finish = (dark: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      io.stdin.removeListener("data", onData);
      restoreRawMode();
      resolve(dark);
    };

    const onData = (chunk: Buffer | string): void => {
      const rgb = parseOsc11Color(String(chunk));
      if (rgb) {
        finish(perceivedBrightness(rgb) < 128);
      }
    };

    const restoreRawMode = (): void => {
      try {
        if (io.stdin.isTTY && typeof io.stdin.setRawMode === "function") {
          io.stdin.setRawMode(wasRaw);
        }
      } catch {
        // A terminal that refuses raw mode also refuses the answer; the
        // timeout decides.
      }
    };

    const timer = setTimeout(() => finish(true), timeoutMs);

    try {
      if (io.stdin.isTTY && typeof io.stdin.setRawMode === "function") {
        wasRaw = io.stdin.isRaw ?? false;
        io.stdin.setRawMode(true);
      }
      io.stdin.on("data", onData);
      io.stdout.write(OSC_BACKGROUND_QUERY);
    } catch {
      finish(true);
    }
  });
}

let detected: boolean | undefined;

/** The probe's answer, when one has been made this session. */
export function detectedTerminalIsDark(): boolean | undefined {
  return detected;
}

/** Test seam: pin the probe's answer without touching a terminal. */
export function setDetectedTerminalIsDark(value: boolean | undefined): void {
  detected = value;
}

/**
 * Resolves a configured value to a choice: `auto` stays a choice so a later
 * probe answer can still change the palette, and a name resolves now.
 */
export function normalizeThemeChoice(name?: string): ThemeName | "auto" {
  const normalized = (name ?? "auto").toLowerCase().trim();
  return normalized === "auto" ? "auto" : resolveThemeName(normalized);
}

/**
 * Resolves the configured theme setting to a theme name. Explicit names pass
 * through unchanged; `auto` or no setting follows the probe.
 */
export function resolveThemeName(name?: string): ThemeName {
  const normalized = (name ?? "auto").toLowerCase().trim();
  if (normalized !== "auto") {
    if (
      normalized === "dark" ||
      normalized === "tencent-dark" ||
      normalized === "tencent-light" ||
      normalized === "light"
    ) {
      return normalized;
    }
    if (normalized.includes("light")) {
      return "tencent-light";
    }
    if (normalized.includes("tencent")) {
      return "tencent-dark";
    }
    // A name this build has no palette for may still be a theme file the user
    // put under the home directory; `getTheme` reads it, or falls back to dark.
    if (fs.existsSync(themeFileFor(normalized))) {
      return normalized;
    }
    return "dark";
  }
  return detected === false ? "light" : "dark";
}
