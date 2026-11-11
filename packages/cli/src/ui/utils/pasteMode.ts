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

/** True when text contains any non-ASCII byte (IME commits, CJK, etc.). */
function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

/**
 * True for a keystroke-shaped payload: one character and no newline. Real
 * paste chunks arrive as multi-character reads; a stranded paste mode that
 * buffered every keystroke and re-armed the silence timer made continuous
 * typing invisible until the user paused.
 */
function isKeystrokePayload(text: string): boolean {
  return text.length === 1 && text !== "\n" && text !== "\r";
}

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
 * Multi-character ASCII payload buffers silently while paste mode is open;
 * the silence timer flushes it even when the end marker never arrives. Single
 * keystrokes and non-ASCII (IME) insert immediately so stranded paste mode
 * cannot swallow the keyboard. Text outside the markers inserts immediately,
 * and the caller owns how an insert lands.
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
    /** Fired when an async silence flush changes the visible buffer. */
    private readonly onChange: () => void = () => {},
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
          this.takePayload(rest);
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
          this.takePayload(before);
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

  /** Forces a pending paste into the text, e.g. before Enter submits. */
  flush(): boolean {
    if (!this._inPasteMode) {
      return false;
    }
    this.exit();
    return true;
  }

  private takePayload(text: string): void {
    // Non-ASCII (IME) and single keystrokes insert immediately so a stranded
    // paste mode cannot swallow the keyboard or re-arm the silence timer on
    // every typed character.
    if (hasNonAscii(text) || isKeystrokePayload(text)) {
      this.insert(text);
      return;
    }
    this._pasteBuffer += text;
    this.armSilenceTimer();
  }

  private enter(): void {
    if (this._inPasteMode) {
      // A start marker while paste mode is open means the end marker for
      // the pending payload never arrived - echo it instead of dropping it
      // with the fresh buffer.
      this.exit();
    }
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
    this.clearSilenceTimer();
    this._pasteSilenceTimer = setTimeout(() => {
      this._pasteSilenceTimer = null;
      if (!this._inPasteMode) {
        return;
      }
      this.exit();
      // Silence fires off the input path, so React never sees the flush
      // unless we notify - without this the text appears only on the next
      // keystroke and feels like the composer is still frozen.
      this.onChange();
    }, PASTE_SILENCE_MS);
  }

  private clearSilenceTimer(): void {
    if (!this._pasteSilenceTimer) {
      return;
    }
    clearTimeout(this._pasteSilenceTimer);
    this._pasteSilenceTimer = null;
  }

  /** Drops any half-seen paste, e.g. when the composer is cleared. */
  clear(): void {
    this.clearSilenceTimer();
    this._inPasteMode = false;
    this._pasteBuffer = "";
  }
}
