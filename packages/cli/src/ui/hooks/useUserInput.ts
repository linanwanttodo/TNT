import { messageQueue } from "../../stream/messageQueue.js";
import { backgroundSignalManager } from "../../utils/backgroundSignalManager.js";
import { requestComposerDraft } from "../composerDraft.js";
import { toggleReasoningExpanded } from "../reasoningFold.js";
import { toggleToolOutputExpanded } from "../toolOutputFold.js";

import type { Key } from "./useKeypress.js";

// Helper function to handle control keys
interface ControlKeysOptions {
  key: Key;
  exit: () => void;
  clearInput?: () => void;
  /**
   * False while a completion popup owns Ctrl+R or the composer is disabled;
   * the queued-message shortcuts then fall through to the focused widget.
   */
  queueActionsEnabled?: boolean;
  /** Opens the command palette; absent when the caller has no palette. */
  onOpenPalette?: () => void;
}

/**
 * How many escape presses one event carries. The gemini parser emits one
 * escape event per ESC byte, so a single press is one event; the sequence is
 * counted anyway in case a terminal coalesces the bytes into one read.
 */
export function escapePresses(key: Key): number {
  if (key.name !== "escape") return 0;
  const escapes = (key.sequence.match(/\x1b/g) ?? []).length;
  return Math.max(1, escapes);
}

export function handleControlKeys(options: ControlKeysOptions): boolean {
  const {
    key,
    exit,
    clearInput,
    queueActionsEnabled = true,
    onOpenPalette,
  } = options;

  // Handle Ctrl+C with two-stage exit, Ctrl+D immediately exits
  if (key.ctrl && key.name === "c") {
    // Clear input box if clearInput function is provided
    if (clearInput) {
      clearInput();
    }
    // Let the main process SIGINT handler handle Ctrl+C logic
    process.kill(process.pid, "SIGINT");
    return true;
  }

  // Handle Ctrl+D to exit
  if (key.ctrl && key.name === "d") {
    exit();
    void import("../../utils/exit.js").then(({ gracefulExit }) =>
      gracefulExit(0),
    );
    return true;
  }

  // Ctrl+P opens the command list, the one key a person tries for a palette.
  if (key.ctrl && key.name === "p" && onOpenPalette) {
    onOpenPalette();
    return true;
  }

  // Handle Ctrl+L to refresh screen (clear terminal artifacts)
  if (key.ctrl && key.name === "l") {
    process.stdout.write("\x1b[2J\x1b[H");
    return true;
  }

  // Handle Ctrl+B to send current tool execution to background
  if (key.ctrl && key.name === "b") {
    backgroundSignalManager.signalBackground();
    return true;
  }

  // Toggle reasoning rows between the first line and the full thought. The
  // tool-output previews fold on the same key, as in the reference CLI.
  if (key.ctrl && key.name === "o") {
    toggleReasoningExpanded();
    toggleToolOutputExpanded();
    return true;
  }

  // Queued-message actions apply to the newest entry: the one a person just
  // added and is most likely to want back.
  if (
    queueActionsEnabled &&
    key.ctrl &&
    (key.name === "x" || key.name === "r")
  ) {
    const queued = messageQueue.getAllMessages();
    const newest = queued[queued.length - 1];
    if (newest) {
      messageQueue.removeMessage(newest.id);
      if (key.name === "r") {
        requestComposerDraft(newest.message);
      }
    }
    return true;
  }

  return false;
}
