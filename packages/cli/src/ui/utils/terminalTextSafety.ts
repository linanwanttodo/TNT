/**
 * Removes the terminal control sequences that make text *do* something, and
 * keeps the ones that only make text look different.
 *
 * Tool output, file contents and fetched pages reach the screen as data, but
 * an escape inside them is executed by the terminal: an OSC can rewrite the
 * title or the clipboard, a CSI can switch to the alternate screen or enable
 * bracketed paste, and an `ESC c` resets it outright. Colour is the one class
 * worth preserving, because the coloured output of test runners and compilers
 * arrives exactly that way and nothing in this front end parses it otherwise.
 */

const CODE_ESCAPE = 0x1b;
const CODE_BELL = 0x07;
const CODE_NEWLINE = 0x0a;
const CODE_TAB = 0x09;
const CODE_DELETE = 0x7f;

function isCsiParameter(code: number): boolean {
  // The parameter and private ranges. `?`, `<`, `=` and `>` live here, and a
  // scan that misses them prints their digits to the screen instead.
  return code >= 0x30 && code <= 0x3f;
}

function isCsiIntermediate(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}

/**
 * Consumes the escape sequence that begins at `start` and reports where the
 * text after it begins.
 * @param text - the whole string being scanned.
 * @param start - the index of the ESC that opens the sequence.
 * @param emit - called with the sequence when it is one to preserve.
 * @returns the index just past the sequence, or the end of the string when the
 * sequence runs out of input, because its extent is then unknowable.
 */
function consumeEscape(
  text: string,
  start: number,
  emit: (kept: string) => void,
): number {
  const length = text.length;
  if (start + 1 >= length) return length;

  const kind = text[start + 1];

  if (kind === "[") {
    let index = start + 2;
    while (index < length && isCsiParameter(text.charCodeAt(index))) index++;
    while (index < length && isCsiIntermediate(text.charCodeAt(index))) index++;
    if (index >= length) return length;
    // Only SGR changes appearance. Every other final byte commands the
    // terminal: erase, mode set, cursor position and reports.
    if (text[index] === "m") emit(text.slice(start, index + 1));
    return index + 1;
  }

  if (
    kind === "]" ||
    kind === "P" ||
    kind === "_" ||
    kind === "^" ||
    kind === "X"
  ) {
    // String sequences close at BEL or ST. An ESC that opens neither means no
    // terminator arrived, so the remainder goes rather than the parameters
    // being shown as text.
    let index = start + 2;
    while (index < length) {
      if (text.charCodeAt(index) === CODE_BELL) return index + 1;
      if (text.charCodeAt(index) === CODE_ESCAPE) {
        return text[index + 1] === "\\" ? index + 2 : length;
      }
      index++;
    }
    return length;
  }

  if (kind === "(" || kind === ")" || kind === "#" || kind === "%") {
    // Charset designation owns one more byte after the ESC.
    return Math.min(start + 3, length);
  }

  // A one-character Fe escape (`c` reset, `7`/`8` save and restore the cursor,
  // `=`/`>` keypad modes). Text after it belongs to the caller, not to it.
  return start + 2;
}

/**
 * Strips the control sequences that command a terminal, preserving SGR colour
 * and the whitespace the layout needs.
 * @param text - text that arrived from outside this process.
 * @returns the same text with every commanding sequence removed.
 */
export function sanitizeTerminalText(text: string): string {
  let out = "";
  let index = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);

    if (code === CODE_ESCAPE) {
      index = consumeEscape(text, index, (kept) => {
        out += kept;
      });
      continue;
    }

    if (code === CODE_NEWLINE || code === CODE_TAB) {
      out += text[index];
      index++;
      continue;
    }

    // Other C0 controls and DEL: a backspace or a carriage return rewrites
    // what the reader sees, and neither is data a tool meant to show.
    if (code < 0x20 || code === CODE_DELETE) {
      index++;
      continue;
    }

    out += text[index];
    index++;
  }

  return out;
}
