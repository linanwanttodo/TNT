/**
 * Terminal mouse reporting. Terminals only send these sequences after the app
 * asks for them; the SGR form (`\x1b[<b;x;yM`) is used because it reports
 * coordinates past column 223 and distinguishes press from release.
 */

export const MOUSE_ENABLE = "\x1b[?1000h\x1b[?1006h";
export const MOUSE_DISABLE = "\x1b[?1000l\x1b[?1006l";

const SGR_PREFIX = "\x1b[<";
const MAX_BUFFER = 4096;

export type MouseEventName =
  | "left-press"
  | "left-release"
  | "right-press"
  | "middle-press"
  | "scroll-up"
  | "scroll-down"
  | "move";

export interface MouseEvent {
  name: MouseEventName;
  /** 1-based terminal column. */
  col: number;
  /** 1-based terminal row. */
  row: number;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

function eventName(code: number, isRelease: boolean): MouseEventName | null {
  if ((code & 64) === 64) {
    if ((code & 32) !== 0) return null; // horizontal wheel: ignore
    return (code & 1) === 0 ? "scroll-up" : "scroll-down";
  }
  if ((code & 32) !== 0) return "move";
  const button = code & 3;
  const phase = isRelease ? "release" : "press";
  if (button === 0) return `left-${phase}` as MouseEventName;
  if (button === 1) return `middle-${phase}` as MouseEventName;
  if (button === 2) return `right-${phase}` as MouseEventName;
  return null;
}

/** Parses one SGR mouse sequence at the start of `buffer`, if present. */
export function parseSgrMouseEvent(
  buffer: string,
): { event: MouseEvent | null; length: number } | null {
  const match = buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!match) return null;

  const code = parseInt(match[1], 10);
  const name = eventName(code, match[4] === "m");
  if (!name) return { event: null, length: match[0].length };

  return {
    event: {
      name,
      col: parseInt(match[2], 10),
      row: parseInt(match[3], 10),
      shift: (code & 4) !== 0,
      meta: (code & 8) !== 0,
      ctrl: (code & 16) !== 0,
    },
    length: match[0].length,
  };
}

/** True while the buffer starts a mouse sequence that has not fully arrived. */
export function isIncompleteMouseSequence(buffer: string): boolean {
  if (!buffer.startsWith("\x1b")) return false;
  if (buffer.startsWith(SGR_PREFIX)) {
    return !/[Mm]/.test(buffer) && buffer.length < 50;
  }
  // A bare ESC or "\x1b[" may still grow into the SGR prefix.
  return SGR_PREFIX.startsWith(buffer) || buffer === "\x1b[";
}

/**
 * Consumes every complete event at the head of the buffer and reports how much
 * was consumed; garbage is discarded up to the next ESC so a stray byte does
 * not wedge the parser.
 */
export function drainMouseEvents(buffer: string): {
  events: MouseEvent[];
  rest: string;
} {
  const events: MouseEvent[] = [];
  let rest = buffer.slice(0, MAX_BUFFER);

  while (rest.length > 0) {
    const parsed = parseSgrMouseEvent(rest);
    if (parsed) {
      if (parsed.event) events.push(parsed.event);
      rest = rest.slice(parsed.length);
      continue;
    }
    if (isIncompleteMouseSequence(rest)) break;

    const nextEscape = rest.indexOf("\x1b", 1);
    rest = nextEscape === -1 ? "" : rest.slice(nextEscape);
  }

  return { events, rest };
}

/**
 * Ink forwards every byte it does not recognise as a key as printable input,
 * which includes the terminal's mouse reports. The composer uses this to drop
 * them instead of typing `[<64;10;10M` into the prompt.
 */
export function isTerminalMouseSequence(input: string): boolean {
  return /\[<\d+;\d+;\d+[Mm]/.test(input);
}

/**
 * The clickable jump target only exists while the reader is scrolled up: the
 * hint is the dock's first row. Coordinates are 1-based rows from the top.
 */
export function isJumpHintClick(
  event: MouseEvent,
  rows: number,
  dockHeight: number,
): boolean {
  if (dockHeight <= 0) return false;
  return event.row === rows - dockHeight + 1;
}
