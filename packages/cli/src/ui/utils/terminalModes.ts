/**
 * ANSI terminal mode helpers, ported from gemini-cli's core terminal utils.
 * TNT does not carry the gemini core; the sequences live here instead.
 */

function writeToStdout(data: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(data);
}

export function enableKittyKeyboardProtocol(): void {
  writeToStdout("\x1b[>1u");
}

export function disableKittyKeyboardProtocol(): void {
  writeToStdout("\x1b[<u");
}

export function enableModifyOtherKeys(): void {
  writeToStdout("\x1b[>4;2m");
}

export function disableModifyOtherKeys(): void {
  writeToStdout("\x1b[>4;0m");
}

export function enableBracketedPasteMode(): void {
  writeToStdout("\x1b[?2004h");
}

export function disableBracketedPasteMode(): void {
  writeToStdout("\x1b[?2004l");
}

export function enableLineWrapping(): void {
  writeToStdout("\x1b[?7h");
}

export function disableLineWrapping(): void {
  writeToStdout("\x1b[?7l");
}

/**
 * Auto-wrap stays off while the alternate buffer is active, and on terminals
 * that render ambiguous-width characters in two cells: Ink places the right
 * border glyph in the last column, so a two-cell glyph there soft-wraps the
 * row and leaves stale copies of the previous frame behind on every render.
 */
export function shouldDisableLineWrapping(
  useAlternateBuffer: boolean,
  ambiguousCharactersWide: boolean,
): boolean {
  return useAlternateBuffer || ambiguousCharactersWide;
}
