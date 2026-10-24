import { useSyncExternalStore } from "react";

/**
 * Whether finished reasoning rows show their full text.
 *
 * This is a view preference rather than a property of a message: the same
 * stored turn can be read collapsed or expanded. Finished blocks start folded;
 * a live block is opened by its `isStreaming` flag until
 * the round ends. Keeping it outside the message means the transcript does not
 * have to be rewritten to change the view.
 */
let expanded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function isReasoningExpanded(): boolean {
  return expanded;
}

export function toggleReasoningExpanded(): void {
  expanded = !expanded;
  emit();
}

export function resetReasoningFold(): void {
  expanded = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReasoningExpanded(): boolean {
  return useSyncExternalStore(
    subscribe,
    isReasoningExpanded,
    isReasoningExpanded,
  );
}
