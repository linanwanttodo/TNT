/**
 * The chat owns the whole screen by default: the alternate buffer is entered
 * on boot, so shell content before launch is restored on exit instead of
 * bleeding through above the interface. Scrolling, wheel and clicks are
 * app-owned, so nothing outside the frame serves the reader.
 *
 * An explicit `TNT_ALT_SCREEN=0` opts back into the terminal's normal buffer
 * for debugging; the frame is still app-owned there.
 */

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[H\x1b[2J";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

let entered = false;
let exitHookInstalled = false;

function write(code: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(code);
}

/** Default: the alternate buffer owns the screen. */
export function alternateScreenEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = (env.TNT_ALT_SCREEN ?? "").trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
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
