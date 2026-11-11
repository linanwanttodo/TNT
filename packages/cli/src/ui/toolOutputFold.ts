import { useSyncExternalStore } from "react";

/**
 * Whether finished tool-output previews show their full text.
 *
 * The reference CLI owns this view preference on one key (ctrl+o) rather than
 * on the mouse: the same stored turn can be read collapsed or expanded, and
 * the transcript does not have to be rewritten to change the view. Finished
 * blocks keep their own override; the global sets the default.
 */
let expanded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function isToolOutputExpanded(): boolean {
  return expanded;
}

export function toggleToolOutputExpanded(): void {
  expanded = !expanded;
  emit();
}

export function resetToolOutputFold(): void {
  expanded = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToolOutputExpanded(): boolean {
  return useSyncExternalStore(subscribe, isToolOutputExpanded);
}
