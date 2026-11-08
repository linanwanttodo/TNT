import { TerminalResponseFilter } from "./terminalResponses.js";

/**
 * The composer's stateful terminal-response filter: keeps one pending hold for
 * a leading "]" or "P" and inserts a flushed prefix through the supplied
 * callbacks. Ink splits a reply at every ESC, so the hold is what lets a
 * multi-event OSC/DCS answer be recognised as a reply rather than as text.
 */
export class ComposerTerminalFilter {
  private filter = new TerminalResponseFilter();
  private flush: NodeJS.Immediate | null = null;

  constructor(
    private readonly insertText: (text: string) => void,
    private readonly onChange: () => void,
  ) {}

  /**
   * Consumes one Ink input event and returns the text the composer should
   * handle, or null when the event was a terminal reply. A lone "]" or "P" is
   * held for one immediate to see whether a reply follows; otherwise it is
   * typed normally.
   */
  consume(input: string, disabled = false): string | null {
    if (disabled) {
      return null;
    }

    const filtered = this.filter.consume(input);
    if (this.flush) {
      clearImmediate(this.flush);
      this.flush = null;
    }
    if (filtered.flush) {
      this.insertText(filtered.flush);
      this.onChange();
    }
    if (filtered.kind === "drop") {
      return null;
    }
    if (filtered.kind === "hold") {
      this.flush = setImmediate(() => {
        this.flush = null;
        const held = this.filter.flushHeld();
        if (!held) {
          return;
        }
        this.insertText(held);
        this.onChange();
      });
      return null;
    }
    return filtered.text ?? input;
  }

  reset(): void {
    if (this.flush) {
      clearImmediate(this.flush);
      this.flush = null;
    }
    this.filter.reset();
  }
}
