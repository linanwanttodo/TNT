/**
 * Terminal replies that arrive on the stdin stream beside keystrokes.
 *
 * Ink has no OSC or DCS parser: it splits input at every ESC and strips the
 * leading escape, so a terminal's OSC colour answer reaches `useInput` as
 * printable text such as `]11;rgb:0000/0000/0000\`. The auto-theme probe runs
 * before Ink owns stdin, but a late or repeated answer still must not reach
 * the composer. These matchers accept only complete reply shapes, so ordinary
 * typing - a lone "]", "[" or "P" included - never matches.
 */

// Ink stripped the ESC from the ST terminator (ESC\), leaving the backslash.
const OSC_COLOR_REPLY =
  /^\x1b?\](?:1[01]|4(?:;\d+)?);rgb:[0-9a-fA-F]{1,4}(?:\/[0-9a-fA-F]{1,4}){2}(?:\x1b?\\|\x07)$/;
const ESC_STRIPPED_OSC_REPLY =
  /^\](?:1[01]|4(?:;\d+)?);rgb:[0-9a-fA-F]{1,4}(?:\/[0-9a-fA-F]{1,4}){2}\\$/;

// DECRQSS replies (`P1$r...`) and XTVERSION replies (`P>|...`).
const DCS_REPLY = /^P(?:\d+\$r|[>|])[^\x1b\x07]*(?:\x1b?\\|\x07)$/;
const RAW_DCS_REPLY = /^\x1bP(?:\d+\$r|[>|])[^\x1b\x07]*(?:\x1b?\\|\x07)$/;
const OSC_REPLY_PAYLOAD =
  /^(?:1[01]|4(?:;\d+)?);rgb:[0-9a-fA-F]{1,4}(?:\/[0-9a-fA-F]{1,4}){2}(?:\x1b?\\|\x07)$/;
const OSC_REPLY_PAYLOAD_WITHOUT_TERMINATOR =
  /^(?:1[01]|4(?:;\d+)?);rgb:[0-9a-fA-F]{1,4}(?:\/[0-9a-fA-F]{1,4}){2}$/;
const DCS_REPLY_PAYLOAD = /^(?:\d+\$r|[>|])[^\x1b\x07]*(?:\x1b?\\|\x07)$/;
const OSC_REPLY_START =
  /^\x1b?\](?:1[01]|4(?:;\d+)?);rgb:[0-9a-fA-F]{1,4}(?:\/[0-9a-fA-F]{1,4}){2}$/;
const OSC_REPLY_FIRST_EVENT = /^\x1b\]$/;

/** True for a complete OSC colour or DCS reply that should be dropped. */
export function isTerminalResponseSequence(input: string): boolean {
  return (
    OSC_COLOR_REPLY.test(input) ||
    ESC_STRIPPED_OSC_REPLY.test(input) ||
    DCS_REPLY.test(input) ||
    RAW_DCS_REPLY.test(input)
  );
}

export interface FilteredInput {
  /** Literal text to insert before the current input is handled. */
  flush?: string;
  /** `drop` and `hold` stop processing; `text` continues normally. */
  kind: "text" | "drop" | "hold";
  /** Replacement text, e.g. what follows a BEL terminator. */
  text?: string;
}

/**
 * Consumes one Ink input event at a time. Ink splits a terminal reply at each
 * ESC, so `ESC]11;rgb:...ESC\` arrives as `]`, `11;rgb:...`, `\`. The leading
 * `]` is held until the next event decides whether it is a reply prefix or an
 * ordinary key; callers flush it with `flushHeld` when no follow-up arrives.
 */
export class TerminalResponseFilter {
  private replyPrefix: "osc" | "dcs" | null = null;
  private awaitingTerminator = false;
  private waitingSince = 0;

  /**
   * A reply that never terminates must not swallow the keyboard: after this
   * window the filter gives up on the pending shape and treats input as text.
   */
  constructor(private readonly retentionMs = 500) {}

  consume(input: string, now = Date.now()): FilteredInput {
    const printable = input.replace(/^\x1b/, "");
    const strippedInput = input.replace(/\x1b/g, "");
    if (OSC_REPLY_FIRST_EVENT.test(input)) {
      this.replyPrefix = "osc";
      this.waitingSince = now;
      return { kind: "hold" };
    }
    if (
      isTerminalResponseSequence(printable) ||
      isTerminalResponseSequence(strippedInput)
    ) {
      this.awaitingTerminator = false;
      this.waitingSince = 0;
      return { kind: "drop" };
    }
    if (OSC_REPLY_START.test(printable)) {
      this.awaitingTerminator = true;
      this.waitingSince = now;
      return { kind: "drop" };
    }
    if (printable === "]" || printable === "P") {
      this.replyPrefix = printable === "]" ? "osc" : "dcs";
      this.waitingSince = now;
      return { kind: "hold" };
    }
    if (this.replyPrefix || printable !== input) {
      const prefix = this.replyPrefix;
      this.replyPrefix = null;
      if (!prefix && printable !== input) {
        if (isTerminalResponseSequence(printable)) return { kind: "drop" };
        return { kind: "text", text: printable };
      }
      if (!prefix) return { kind: "text" };
      const payload = prefix === "osc" ? OSC_REPLY_PAYLOAD : DCS_REPLY_PAYLOAD;
      const splitOscPayload =
        prefix === "osc" &&
        OSC_REPLY_PAYLOAD_WITHOUT_TERMINATOR.test(printable);
      if (splitOscPayload) {
        this.awaitingTerminator = true;
        this.waitingSince = now;
        return { kind: "drop" };
      }
      if (
        now - this.waitingSince <= this.retentionMs &&
        payload.test(printable)
      ) {
        return { kind: "drop" };
      }
      const flush = prefix === "osc" ? "]" : "P";
      return { kind: "text", flush, text: printable };
    }
    if (this.awaitingTerminator) {
      if (now - this.waitingSince > this.retentionMs) {
        this.awaitingTerminator = false;
      } else {
        // The payload may carry a BEL terminator; the ST backslash is its own
        // event because Ink split at that ESC.
        const bel = input.indexOf("\x07");
        if (bel >= 0) {
          this.awaitingTerminator = false;
          const rest = input.slice(bel + 1);
          return rest ? { kind: "text", text: rest } : { kind: "drop" };
        }
        if (input.endsWith("\\")) {
          this.awaitingTerminator = false;
        }
        return { kind: "drop" };
      }
    }

    if (isTerminalResponseSequence(printable)) {
      return { kind: "drop" };
    }

    return printable === input
      ? { kind: "text" }
      : { kind: "text", text: printable };
  }

  /** Gives back a held prefix when no follow-up event arrived. */
  flushHeld(): string | undefined {
    const prefix = this.replyPrefix;
    this.replyPrefix = null;
    return prefix === "osc" ? "]" : prefix === "dcs" ? "P" : undefined;
  }

  /** Drops any half-seen reply, e.g. when the composer is cleared. */
  reset(): void {
    this.replyPrefix = null;
    this.awaitingTerminator = false;
  }
}

/**
 * The bracketed-paste markers in either form: the raw escape sequence, and
 * the marker Ink leaves after stripping the ESC (`[200~` / `[201~`). Ink 6
 * always delivers the second form, which is why the raw form alone can never
 * enter paste mode.
 */
export function bracketedPasteMarker(
  input: string,
): "start" | "end" | undefined {
  if (input === "\x1b[200~" || input === "[200~") {
    return "start";
  }
  if (input === "\x1b[201~" || input === "[201~") {
    return "end";
  }
  return undefined;
}
