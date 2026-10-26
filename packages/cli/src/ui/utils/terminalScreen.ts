/**
 * The chat runs in the terminal's alternate screen buffer.
 *
 * A full-height Ink frame makes Ink take its fullscreen branch, which clears
 * the normal buffer with `ESC[3J` on every frame - that is what used to wipe
 * the reader's scrollback. Inside the alternate buffer those clears are
 * contained: the app owns the screen while it runs, and leaving the buffer
 * restores the shell exactly as it was. In exchange the app must provide its
 * own scrolling, which `useChatViewport` does.
 */

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[H\x1b[2J";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

let entered = false;
let exitHookInstalled = false;

function write(code: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(code);
}

/**
 * The alternate buffer is the default because Ink's fullscreen branch clears
 * the normal buffer. A user who wants terminal scrollback instead can set
 * `CONTINUE_CLI_ALT_SCREEN=0`; the transcript then renders settled rows through
 * `<Static>` and keeps only the live tail in the frame.
 */
export function alternateScreenEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = (env.CONTINUE_CLI_ALT_SCREEN ?? "").trim().toLowerCase();
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
