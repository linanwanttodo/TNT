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
  /^\](?:1[01]|4(?:;\d+)?);rgb:[0-9a-fA-F]{1,4}(?:\/[0-9a-fA-F]{1,4}){2}(?:\x1b?\\|\x07)$/;

// DECRQSS replies (`P1$r...`) and XTVERSION replies (`P>|...`).
const DCS_REPLY = /^P(?:\d+\$r|[>|])[^\x1b\x07]*(?:\x1b?\\|\x07)$/;

/** True for a complete OSC colour or DCS reply that should be dropped. */
export function isTerminalResponseSequence(input: string): boolean {
  return OSC_COLOR_REPLY.test(input) || DCS_REPLY.test(input);
}

export interface FilteredInput {
  /** Literal text to insert before the current input is handled. */
  flush?: string;
  /** `drop` and `hold` stop processing; `text` continues normally. */
  kind: "text" | "drop" | "hold";
  /** Replacement text, e.g. what follows a BEL terminator. */
  text?: string;
}

const OSC_PAYLOAD = /^(?:1[01]|4(?:;\d+)?);rgb:/;
const DCS_PAYLOAD = /^(?:\d+\$r|[>|])/;

/**
 * Consumes one Ink input event at a time. Ink splits a terminal reply at each
 * ESC, so `ESC]11;rgb:...ESC\` arrives as `]`, `11;rgb:...`, `\`. The leading
 * `]` is held until the next event decides whether it is a reply prefix or an
 * ordinary key; callers flush it with `flushHeld` when no follow-up arrives.
 */
export class TerminalResponseFilter {
  private held: { text: string; payload: RegExp; since: number } | null = null;
  private awaitingTerminator = false;
  private waitingSince = 0;

  /**
   * A reply that never terminates must not swallow the keyboard: after this
   * window the filter gives up on the pending shape and treats input as text.
   */
  constructor(private readonly retentionMs = 500) {}

  consume(input: string, now = Date.now()): FilteredInput {
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

    if (this.held) {
      const held = this.held;
      this.held = null;
      if (now - held.since > this.retentionMs) {
        return { kind: "text", flush: held.text };
      }
      if (held.payload.test(input)) {
        const bel = input.indexOf("\x07");
        if (bel >= 0) {
          const rest = input.slice(bel + 1);
          return rest ? { kind: "text", text: rest } : { kind: "drop" };
        }
        if (input.endsWith("\\")) {
          return { kind: "drop" };
        }
        this.awaitingTerminator = true;
        this.waitingSince = now;
        return { kind: "drop" };
      }
      // Not a reply after all: the held prefix is ordinary text. Flush it and
      // let the current input take the normal path.
      return { kind: "text", flush: held.text };
    }

    if (isTerminalResponseSequence(input)) {
      return { kind: "drop" };
    }

    if (input === "]") {
      this.held = { text: "]", payload: OSC_PAYLOAD, since: now };
      return { kind: "hold" };
    }
    if (input === "P") {
      this.held = { text: "P", payload: DCS_PAYLOAD, since: now };
      return { kind: "hold" };
    }

    return { kind: "text" };
  }

  /** Gives back a held prefix when no follow-up event arrived. */
  flushHeld(): string | undefined {
    const held = this.held;
    this.held = null;
    return held?.text;
  }

  /** Drops any half-seen reply, e.g. when the composer is cleared. */
  reset(): void {
    this.held = null;
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
