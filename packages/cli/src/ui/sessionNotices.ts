import { useSyncExternalStore } from "react";

/**
 * Terminal-only notices that belong to the session, not to the conversation.
 *
 * A `/webui` answer carries a one-time token in its URL, so it must never be
 * written into chat history: the session file would keep it, and every shared
 * web view would replay it. Rendering it in the transcript is what makes it
 * findable again later, so the notice lives in this tiny in-memory store —
 * visible for the whole session, gone on exit, and out of every prompt.
 */
const MAX_NOTICES = 20;

let notices: readonly string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Append a notice for the transcript; the oldest one falls off the end. */
export function appendSessionNotice(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const next = [...notices, trimmed];
  notices =
    next.length > MAX_NOTICES ? next.slice(next.length - MAX_NOTICES) : next;
  emit();
}

/** Drop every notice, for a session reset or a rewind. */
export function clearSessionNotices(): void {
  if (notices.length === 0) return;
  notices = [];
  emit();
}

export function getSessionNotices(): readonly string[] {
  return notices;
}

export function subscribeSessionNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The notices the transcript should render right now. */
export function useSessionNotices(): readonly string[] {
  return useSyncExternalStore(
    subscribeSessionNotices,
    getSessionNotices,
    getSessionNotices,
  );
}
