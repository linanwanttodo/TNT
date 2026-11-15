import type { ChatHistoryItem } from "core/index.js";

/**
 * Builds the history used to ask a model for a summary, in a shape that keeps
 * the request prefix byte-identical to the turns that came before it.
 *
 * A summary request normally repeats the system prompt and the tool
 * definitions, because the summarizer is a model that needs them to understand
 * the conversation. It does not follow that those repeated tokens are free:
 * they are part of the cached sequence, and a request that reshapes them
 * invalidates every cached token from the first difference onward.
 *
 * Folding the conversation into a single string appended as one new user
 * message guarantees a full cache miss on every compaction. Replaying the
 * history unchanged and appending the instruction last means the prefix the
 * provider already holds is still a prefix of this request.
 */

export interface PrefixPreservingHistory {
  /** History to send, ending with the instruction. */
  readonly history: ChatHistoryItem[];
  /**
   * How many leading items are unchanged from the original history. Everything
   * before this index is the reusable prefix.
   */
  readonly reusablePrefixLength: number;
}

/**
 * Appends the summary instruction without disturbing anything before it.
 *
 * Tool definitions are not touched here: they are supplied separately to the
 * request, and they are part of the cached sequence whether or not the
 * summarizer will invoke them. Omitting them because the summarizer has no
 * tools would misalign every following token and forfeit the reuse.
 */
export function buildSummaryRequest(
  history: readonly ChatHistoryItem[],
  instruction: string,
): PrefixPreservingHistory {
  return {
    history: [
      ...history,
      {
        message: { role: "user" as const, content: instruction },
        contextItems: [],
      },
    ],
    reusablePrefixLength: history.length,
  };
}

/**
 * True when everything the previous request sent as a prefix is still a
 * leading part of the next request, unchanged. That is the condition for the
 * provider to read the prefix back rather than write it again.
 */
export function isPrefixReusable(
  previous: readonly ChatHistoryItem[],
  next: readonly ChatHistoryItem[],
): boolean {
  if (next.length < previous.length) {
    return false;
  }
  for (let i = 0; i < previous.length; i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(next[i])) {
      return false;
    }
  }
  return true;
}
