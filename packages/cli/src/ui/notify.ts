/**
 * A terminal-side "the turn is done" marker, for the terminal that shows one.
 *
 * This is not the `notify` command in settings, which runs a program; it is the
 * escape sequence a terminal emulator turns into its own notification, so it
 * needs nothing installed. It is off unless asked for (`TNT_NOTIFY`), because a
 * bell on every turn is noise, and it stays quiet for a turn that ended so fast
 * the reader never left the window - which is what the duration gate is for.
 */
export type NotifyMode = "off" | "bell" | "osc9";

/** Turns shorter than this never notify: nobody switched away in ten seconds. */
export const NOTIFY_MIN_MS = 10_000;

export function notifyMode(env: NodeJS.ProcessEnv = process.env): NotifyMode {
  const raw = (env.TNT_NOTIFY ?? "").toLowerCase().trim();
  if (raw === "bell") {
    return "bell";
  }
  if (raw === "1" || raw === "on" || raw === "osc9") {
    return "osc9";
  }
  return "off";
}

export function notifySequence(
  mode: NotifyMode,
  text: string,
): string | undefined {
  if (mode === "bell") {
    return "\u0007";
  }
  if (mode === "osc9") {
    return `\u001B]9;${text}\u0007`;
  }
  return undefined;
}

export function notifyTurnComplete(options: {
  mode?: NotifyMode;
  elapsedMs: number;
  text: string;
  write?: (sequence: string) => void;
}): boolean {
  const mode = options.mode ?? notifyMode();
  if (mode === "off" || options.elapsedMs < NOTIFY_MIN_MS) {
    return false;
  }
  const sequence = notifySequence(mode, options.text);
  if (!sequence) {
    return false;
  }
  (options.write ?? ((value) => process.stdout.write(value)))(sequence);
  return true;
}
