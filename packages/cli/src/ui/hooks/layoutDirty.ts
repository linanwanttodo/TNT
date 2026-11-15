import { useSyncExternalStore } from "react";

/**
 * A small broadcast for "something inside the transcript changed height".
 *
 * A component's own state can change the layout without re-rendering the
 * ScrollView above it: folding a tool panel is the common case. Ink computes
 * the new layout during the commit, but the ScrollView only measures when it
 * renders. Marking the layout dirty makes the viewport owner render once more,
 * which runs the measurement against the layout that was just committed.
 */
let revision = 0;
const listeners = new Set<() => void>();

export function markLayoutDirty(): void {
  revision += 1;
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

function getRevision(): number {
  return revision;
}

/** Re-renders the caller whenever a nested block changed its height. */
export function useLayoutRevision(): number {
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}
