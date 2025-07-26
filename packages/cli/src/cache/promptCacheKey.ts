import type { Session } from "core/index.js";

import { getCurrentSession } from "../session.js";
import { logger } from "../util/logger.js";

/**
 * Pins one conversation to a single prompt cache.
 *
 * The key follows the conversation rather than the request, so every turn of a
 * session keeps reusing the same cached prefix instead of being routed to a
 * cold one. A delegated run reports the session it was spawned from, so the
 * system prompt and tool schema shared with the parent stay cached and the
 * child stops evicting the parent's entry on every call.
 */
export function promptCacheKeyForSession(
  session: Pick<Session, "sessionId" | "parentSessionId">,
): string {
  return `tnt-${session.parentSessionId ?? session.sessionId}`;
}

/**
 * Cache key for the conversation this process is working on, or undefined when
 * no session exists yet (startup probes can issue requests before one is open).
 */
export function currentPromptCacheKey(): string | undefined {
  try {
    return promptCacheKeyForSession(getCurrentSession());
  } catch (error) {
    logger.debug("No session available to derive a prompt cache key", {
      error,
    });
    return undefined;
  }
}
