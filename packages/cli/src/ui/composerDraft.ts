import { useSyncExternalStore } from "react";

/**
 * A one-shot handoff from a queued message to the composer.
 *
 * Editing a queued message means removing it from the queue and putting its
 * text back where the person can change it. That crosses sibling components
 * (the transcript and the composer), so the handoff is a tiny external store
 * rather than a prop threaded through every screen.
 */
export interface ComposerDraft {
  id: number;
  text: string;
}

let pending: ComposerDraft | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestComposerDraft(text: string): void {
  pending = { id: nextId++, text };
  emit();
}

/** Clears the draft only if it is still the one the composer consumed. */
export function consumeComposerDraft(id: number): void {
  if (pending?.id !== id) {
    return;
  }
  pending = null;
  emit();
}

export function getComposerDraft(): ComposerDraft | null {
  return pending;
}

/** Test and session cleanup: drop a draft nobody consumed. */
export function resetComposerDraft(): void {
  if (pending === null) {
    return;
  }
  pending = null;
  emit();
}

export function useComposerDraft(): ComposerDraft | null {
  return useSyncExternalStore(subscribe, getComposerDraft, getComposerDraft);
}
