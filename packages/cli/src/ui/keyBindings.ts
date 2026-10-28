import type { TranslationKey } from "../i18n/index.js";

/**
 * The keyboard shortcuts this interface actually answers to, in one place.
 *
 * `/help` printed a hand-written list while the key handlers lived in three other
 * files, so the two drifted: question mark? Reasoning fold? Background? The list
 * here is the one `/help` renders and the one the documentation table is checked
 * against, which is what keeps a shortcut from existing nowhere but the key
 * handler.
 *
 * The *dispatch* stays where each key is answered - this file does not bind
 * anything. It is the contract between the handlers and what a reader is told.
 */
export interface KeyBinding {
  /** As a reader types it; `/` separates alternates of one action. */
  keys: string;
  descriptionKey: TranslationKey;
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  { keys: "Enter", descriptionKey: "help.navigationSubmit" },
  { keys: "Shift+Enter", descriptionKey: "help.navigationNewLine" },
  { keys: "Tab", descriptionKey: "help.navigationComplete" },
  { keys: "Up/Down", descriptionKey: "help.navigationMove" },
  { keys: "Shift+Tab", descriptionKey: "help.controlsModes" },
  { keys: "Esc", descriptionKey: "help.controlsCancel" },
  { keys: "Ctrl+F", descriptionKey: "help.controlsHistory" },
  { keys: "Ctrl+P", descriptionKey: "help.controlsPalette" },
  { keys: "Ctrl+O", descriptionKey: "help.controlsReasoning" },
  { keys: "Ctrl+B", descriptionKey: "help.controlsBackground" },
  { keys: "Ctrl+X/Ctrl+R", descriptionKey: "help.controlsQueueRemove" },
  { keys: "Ctrl+V", descriptionKey: "help.controlsPaste" },
  { keys: "PageUp/PageDown", descriptionKey: "help.controlsScrollPage" },
  { keys: "Home/End", descriptionKey: "help.controlsTranscriptHome" },
  { keys: "Ctrl+End", descriptionKey: "help.controlsTranscriptTail" },
  { keys: "Ctrl+L", descriptionKey: "help.controlsClearScreen" },
  { keys: "Ctrl+C", descriptionKey: "help.controlsClearInput" },
  { keys: "Ctrl+D", descriptionKey: "help.controlsExit" },
];

/** The rows a documentation table should carry, without the prose around them. */
export function documentedKeys(): string[] {
  return KEY_BINDINGS.flatMap((binding) => binding.keys.split("/"));
}
