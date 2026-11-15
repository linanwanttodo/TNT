import { useSyncExternalStore } from "react";

/**
 * Terminal-only notices that belong to the screen, not to the conversation.
 * A `/webui` answer carries a one-time token in its URL, so it must never be
 * written into chat history: the session file would keep it, every prompt
 * would carry it, and shared web views would replay it. Each row remembers how
 * many transcript messages existed when the command ran, so it stays at that
 * position as later messages arrive instead of following the bottom.
 */
export interface SessionNotice {
  readonly id: number;
  readonly text: string;
  readonly historyLength: number;
}

const MAX_NOTICES = 20;

let notices: readonly SessionNotice[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Append a transcript row anchored to the message count at command time. */
export function appendSessionNotice(text: string, historyLength: number): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const notice: SessionNotice = {
    id: ++nextId,
    text: trimmed,
    historyLength: Math.max(0, Math.floor(historyLength)),
  };
  const next = [...notices, notice];
  notices =
    next.length > MAX_NOTICES ? next.slice(next.length - MAX_NOTICES) : next;
  emit();
}

/** Drop every notice, for a new session or a session switch. */
export function clearSessionNotices(): void {
  if (notices.length === 0) return;
  notices = [];
  emit();
}

export function getSessionNotices(): readonly SessionNotice[] {
  return notices;
}

export function subscribeSessionNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The notices the transcript should render right now. */
export function useSessionNotices(): readonly SessionNotice[] {
  return useSyncExternalStore(
    subscribeSessionNotices,
    getSessionNotices,
    getSessionNotices,
  );
}

/**
 * Which message index each row belongs after. Anchors beyond the current
 * history are clamped to its end, so a row from a trimmed history does not
 * strand itself in an empty slot.
 */
export function noticesByHistoryIndex(
  source: readonly SessionNotice[],
  historyLength: number,
): Map<number, readonly SessionNotice[]> {
  const buckets = new Map<number, SessionNotice[]>();
  for (const notice of source) {
    const index = Math.max(0, Math.min(notice.historyLength, historyLength));
    const bucket = buckets.get(index) ?? [];
    bucket.push(notice);
    buckets.set(index, bucket);
  }
  return buckets;
}
