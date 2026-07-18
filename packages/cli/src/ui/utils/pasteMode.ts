import { shouldCollapsePaste } from "./bufferLimits.js";
import { firstPasteMarker } from "./terminalResponses.js";

/**
 * How long paste mode waits for more payload before flushing on its own. The
 * end marker normally arrives within milliseconds of the payload it closes,
 * so a window this long only expires when the marker was lost - the terminal
 * coalesced it into a later read, or the reply filter ate it - and the buffer
 * must come out instead of holding the keyboard silently forever.
 */
export const PASTE_SILENCE_MS = 250;

/**
 * The bracketed-paste state machine, extracted from TextBuffer to keep the
 * buffer itself under the max-lines budget.
 *
 * Markers are matched by position, not by whole-string equality: the terminal
 * coalesces reads and ink only splits at ESC, so an end marker arrives glued
 * to the text around it as often as alone - an exact match used to swallow a
 * glued end marker into the paste payload and strand paste mode with the
 * keyboard silently buffered forever.
 *
 * The payload buffers silently while paste mode is open; the silence timer
 * flushes it even when the end marker never arrives. Text outside the markers
 * inserts immediately, and the caller owns how an insert lands.
 */
export class PasteModeHandler {
  private _inPasteMode = false;
  private _pasteBuffer = "";
  private _pasteSilenceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly insert: (text: string) => void,
    /** Folds an over-threshold paste behind a placeholder and returns it. */
    private readonly collapse: (buffered: string) => string,
    private readonly clearRapidTimer: () => void,
  ) {}

  get inPasteMode(): boolean {
    return this._inPasteMode;
  }

  get buffer(): string {
    return this._pasteBuffer;
  }

  /**
   * Consumes one input event. Returns true when the event is paste-owned -
   * the caller skips its key handlers for it; false when the event is plain
   * input the caller handles itself.
   */
  consume(input: string): boolean {
    let rest = input;
    let consumed = false;

    while (rest) {
      const marker = firstPasteMarker(rest);
      if (!marker) {
        if (this._inPasteMode) {
          // Payload between the markers; the silence timer flushes it even
          // when the end marker never arrives.
          this._pasteBuffer += rest;
          this.armSilenceTimer();
          consumed = true;
        } else if (consumed) {
          // Text glued after a flushed end marker inserts normally.
          this.insert(rest);
          consumed = true;
        }
        // Otherwise plain input: not a paste concern; the caller's key
        // handlers own it.
        break;
      }

      const before = rest.slice(0, marker.at);
      rest = rest.slice(marker.at + marker.length);

      if (before) {
        if (this._inPasteMode) {
          this._pasteBuffer += before;
        } else {
          this.insert(before);
        }
      }

      if (marker.kind === "start") {
        this.enter();
      } else {
        this.exit();
      }
      consumed = true;
    }

    return consumed;
  }

  private enter(): void {
    // Clear any pending rapid input timer to avoid conflicts
    this.clearRapidTimer();
    this._inPasteMode = true;
    this._pasteBuffer = "";
    this.armSilenceTimer();
  }

  private exit(): void {
    this.clearSilenceTimer();
    this._inPasteMode = false;

    const buffered = this._pasteBuffer;
    this._pasteBuffer = "";
    if (!buffered) {
      return;
    }

    if (shouldCollapsePaste(buffered)) {
      this.insert(this.collapse(buffered));
    } else {
      this.insert(buffered);
    }
  }

  private armSilenceTimer(): void {
    if (this._pasteSilenceTimer) {
      clearTimeout(this._pasteSilenceTimer);
    }
    this._pasteSilenceTimer = setTimeout(() => {
      this._pasteSilenceTimer = null;
      if (this._inPasteMode) {
        this.exit();
      }
    }, PASTE_SILENCE_MS);
  }

  private clearSilenceTimer(): void {
    if (this._pasteSilenceTimer) {
      clearTimeout(this._pasteSilenceTimer);
      this._pasteSilenceTimer = null;
    }
  }

  /** Drops any half-seen paste, e.g. when the composer is cleared. */
  clear(): void {
    this.clearSilenceTimer();
    this._inPasteMode = false;
    this._pasteBuffer = "";
  }
}
