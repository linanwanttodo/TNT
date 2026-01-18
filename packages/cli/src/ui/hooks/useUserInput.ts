import { messageQueue } from "../../stream/messageQueue.js";
import { backgroundSignalManager } from "../../utils/backgroundSignalManager.js";
import { getClipboardImage } from "../../utils/clipboard.js";
import { logger } from "../../utils/logger.js";
import { requestComposerDraft } from "../composerDraft.js";
import { toggleReasoningExpanded } from "../reasoningFold.js";
import type { TextBuffer } from "../TextBuffer.js";

// Helper function to handle control keys
interface ControlKeysOptions {
  input: string;
  key: any;
  exit: () => void;
  clearInput?: () => void;
  textBuffer?: TextBuffer;
  onTextBufferUpdate?: () => void;
  /**
   * False while a completion popup owns Ctrl+R or the composer is disabled;
   * the queued-message shortcuts then fall through to the focused widget.
   */
  queueActionsEnabled?: boolean;
}

/**
 * How many Esc presses the bytes of one input event carry.
 *
 * Two quick presses reach a terminal reader either as two events or, when the
 * writes coalesce, as one `escape` event whose input still holds the second
 * ESC byte - Ink 6.8 delivers the second form. Counting the bytes is what
 * keeps "double Esc" meaning two presses: a timer that waits for a second
 * *event* never sees one, and the shortcut dies depending on how the
 * terminal buffered the keystrokes.
 */
export function escapePresses(input: string, key: any): number {
  if (!key.escape) return 0;
  const extra = (input.match(/\x1b/g) ?? []).length;
  return 1 + extra;
}

export function handleControlKeys(options: ControlKeysOptions): boolean {
  const {
    input,
    key,
    exit,
    clearInput,
    textBuffer,
    onTextBufferUpdate,
    queueActionsEnabled = true,
  } = options;

  // Handle Ctrl+C with two-stage exit, Ctrl+D immediately exits
  if (key.ctrl && input === "c") {
    // Clear input box if clearInput function is provided
    if (clearInput) {
      clearInput();
    }
    // Let the main process SIGINT handler handle Ctrl+C logic
    process.kill(process.pid, "SIGINT");
    return true;
  }

  // Handle Ctrl+V for clipboard paste (including images)
  // Note: Cmd+V often doesn't work for image pasting as terminals don't send the key event
  if (key.ctrl && input === "v" && textBuffer) {
    logger.debug("Handling Ctrl+V clipboard paste");

    // Read the image directly: the cheap status probe and the full read use
    // different backends on a Linux box that only has the native X11 helper.
    getClipboardImage()
      .then((imageBuffer) => {
        if (!imageBuffer) return;
        try {
          textBuffer.addImage(imageBuffer);
          // Trigger UI update
          if (onTextBufferUpdate) {
            onTextBufferUpdate();
          }
        } catch (error) {
          logger.debug("Error adding clipboard image:", error);
        }
      })
      .catch((error) => {
        logger.debug("Error reading clipboard image:", error);
      });

    // Don't consume the event - let normal text paste handling continue
    return false;
  }

  // Handle Ctrl+D to exit
  if (key.ctrl && input === "d") {
    exit();
    import("../../utils/exit.js").then(({ gracefulExit }) => gracefulExit(0));
  }

  // Handle Ctrl+L to refresh screen (clear terminal artifacts)
  if (key.ctrl && input === "l") {
    process.stdout.write("\x1b[2J\x1b[H");
    return true;
  }

  // Handle Ctrl+B to send current tool execution to background
  if (key.ctrl && input === "b") {
    backgroundSignalManager.signalBackground();
    return true;
  }

  // Toggle reasoning rows between the first line and the full thought.
  if (key.ctrl && input === "o") {
    toggleReasoningExpanded();
    return true;
  }

  // Queued-message actions apply to the newest entry: the one a person just
  // added and is most likely to want back.
  if (queueActionsEnabled && key.ctrl && (input === "x" || input === "r")) {
    const queued = messageQueue.getAllMessages();
    const newest = queued[queued.length - 1];
    if (newest) {
      messageQueue.removeMessage(newest.id);
      if (input === "r") {
        requestComposerDraft(newest.message);
      }
    }
    return true;
  }

  return false;
}

// Helper to update text buffer state
interface TextBufferStateOptions {
  handled: boolean;
  textBuffer: any;
  setInputText: (text: string) => void;
  setCursorPosition: (pos: number) => void;
  updateSlashCommandState: (text: string, cursor: number) => void;
  updateFileSearchState: (text: string, cursor: number) => void;
  updateBashModeState: (text: string) => void;
  inputHistory: any;
}

export function updateTextBufferState(options: TextBufferStateOptions) {
  const {
    handled: _handled,
    textBuffer,
    setInputText,
    setCursorPosition,
    updateSlashCommandState,
    updateFileSearchState,
    updateBashModeState,
    inputHistory,
  } = options;

  // Skip state updates during rapid input mode to avoid conflicts with timer-based updates
  if (!textBuffer.isInRapidInputMode()) {
    const newText = textBuffer.text;
    const newCursor = textBuffer.cursor;
    setInputText(newText);
    setCursorPosition(newCursor);
    updateSlashCommandState(newText, newCursor);
    updateFileSearchState(newText, newCursor);
    updateBashModeState(newText);
    inputHistory.resetNavigation();
  }
}
