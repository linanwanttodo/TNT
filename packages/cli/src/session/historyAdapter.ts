import type { BaseSessionMetadata, Session } from "core/index.js";
import type { ListHistoryOptions } from "core/protocol/core.js";

import { sessionStore } from "./store.js";

/**
 * The session/index.ts persistence seam. The old implementation was core's
 * HistoryManager (one JSON snapshot plus a shared sessions.json index). This
 * adapter keeps the same shape so the callers and their mocks stay small, while
 * the real work is the append-only store behind it.
 */
export interface HistoryAdapter {
  save(session: Session): void;
  load(sessionId: string): Session;
  list(options: ListHistoryOptions): BaseSessionMetadata[];
  delete(sessionId: string): void;
  clearAll(): void;
}

export const historyAdapter: HistoryAdapter = {
  save(session) {
    sessionStore.sync(session);
  },

  load(sessionId) {
    const loaded = sessionStore.load(sessionId);
    if (!loaded) {
      throw new Error(`Session ${sessionId} does not exist`);
    }
    return loaded.session;
  },

  list(options) {
    return sessionStore.list({
      cwd: options.workspaceDirectory,
      limit: options.limit,
      offset: options.offset,
    });
  },

  delete(sessionId) {
    sessionStore.delete(sessionId);
  },

  clearAll() {
    sessionStore.clearAll();
  },
};
