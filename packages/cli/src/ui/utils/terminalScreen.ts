/**
 * The chat stays in the terminal's normal buffer by default, the way the
 * reference CLIs do: settled transcript rows go out once through `<Static>`
 * and land in the terminal's scrollback, so the reader scrolls up and
 * selects/copies with the terminal's own gestures. No mouse capture, no
 * shortcut to remember.
 *
 * An explicit `TNT_ALT_SCREEN=1` switches to the alternate buffer. There the
 * app owns the screen and must provide its own scrolling and mouse handling;
 * the terminal's native copy is no longer available.
 */

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[H\x1b[2J";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

let entered = false;
let exitHookInstalled = false;

function write(code: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(code);
}

/** Explicit opt-in: the normal buffer is the default. */
export function alternateScreenEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = (env.TNT_ALT_SCREEN ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

export function enterAlternateScreen(): void {
  if (!exitHookInstalled) {
    // A crash or an unhandled exit path must not leave the shell on the
    // alternate buffer with no prompt.
    process.once("exit", leaveAlternateScreen);
    exitHookInstalled = true;
  }
  if (entered) return;
  write(ENTER_ALT_SCREEN);
  entered = true;
}

export function leaveAlternateScreen(): void {
  if (!entered) return;
  write(LEAVE_ALT_SCREEN);
  entered = false;
}
