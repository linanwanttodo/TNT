import { useSyncExternalStore } from "react";

/**
 * A post-turn prompt suggestion: the text the model predicts the user will
 * type next, shown faint in the empty composer and accepted with Tab.
 *
 * The turn loop sets it once its answer is complete; the composer reads it
 * through the hook. Like the reasoning override, this crosses siblings that do
 * not share a prop tree, so it is a tiny external store in the session layer.
 */
export interface PromptSuggestion {
  text: string;
  /** Set the first time the composer renders it; 0 means not yet shown. */
  shownAt: number;
}

let suggestion: PromptSuggestion | null = null;
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

/** Offers a new suggestion, replacing any earlier one. */
export function setPromptSuggestion(text: string): void {
  suggestion = text.trim() ? { text: text.trim(), shownAt: 0 } : null;
  emit();
}

/** The composer calls this the first time it renders the suggestion. */
export function markPromptSuggestionShown(): void {
  if (suggestion && suggestion.shownAt === 0) {
    suggestion = { ...suggestion, shownAt: Date.now() };
    emit();
  }
}

/** Any keystroke or submission clears the suggestion. */
export function clearPromptSuggestion(): void {
  if (suggestion === null) return;
  suggestion = null;
  emit();
}

export function getPromptSuggestion(): PromptSuggestion | null {
  return suggestion;
}

export function usePromptSuggestion(): PromptSuggestion | null {
  return useSyncExternalStore(
    subscribe,
    getPromptSuggestion,
    getPromptSuggestion,
  );
}
