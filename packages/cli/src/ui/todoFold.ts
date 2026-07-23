import { useSyncExternalStore } from "react";

/**
 * Whether the todo panel above the composer shows its rows or only the header.
 *
 * The same view-preference pattern as the tool-output fold (ctrl+o): one key
 * owns the state, a finished plan reads collapsed or expanded without
 * rewriting anything, and the panel itself stays mounted.
 */
let expanded = true;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function isTodoExpanded(): boolean {
  return expanded;
}

export function toggleTodoExpanded(): void {
  expanded = !expanded;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTodoExpanded(): boolean {
  return useSyncExternalStore(subscribe, isTodoExpanded);
}
