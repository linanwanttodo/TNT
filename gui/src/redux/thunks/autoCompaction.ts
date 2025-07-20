import {
  AutoCompactionState,
  shouldAutoCompact,
} from "core/util/autoCompaction";
import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  autoCompactionFailed,
  autoCompactionSucceeded,
  beginAutoCompaction,
  setContextBreakdown,
  setContextPercentage,
} from "../slices/sessionSlice";
import { AppThunkDispatch } from "../store";
import { loadSession } from "./session";

export interface AutoCompactionInput {
  dispatch: AppThunkDispatch;
  ideMessenger: IIdeMessenger;
  sessionId: string;
  historyLength: number;
  contextPercentage?: number;
  state: AutoCompactionState;
}

/**
 * Summarizes the conversation once it approaches the context limit, so the next
 * turn starts from a smaller window instead of dropping messages. Runs between
 * turns, after the current exchange has been persisted, and leaves the summary
 * on the last history item as the visible boundary between summarized and live
 * messages.
 *
 * Returns true when a compaction actually ran, so callers can tell the two
 * "nothing to do" cases (window not full, breaker tripped) from real work.
 */
export async function autoCompactIfNeeded({
  dispatch,
  ideMessenger,
  sessionId,
  historyLength,
  contextPercentage,
  state,
}: AutoCompactionInput): Promise<boolean> {
  if (
    !sessionId ||
    historyLength === 0 ||
    !shouldAutoCompact(contextPercentage, state)
  ) {
    return false;
  }

  dispatch(beginAutoCompaction());
  try {
    await ideMessenger.request("conversation/compact", {
      index: historyLength - 1,
      sessionId,
    });

    dispatch(loadSession({ sessionId, saveCurrentSession: false }));
    dispatch(autoCompactionSucceeded());

    // The window is smaller now; clear the stale reading so the next turn
    // measures the compacted history instead of showing the pre-compaction
    // percentage.
    dispatch(setContextPercentage(undefined));
    dispatch(setContextBreakdown(undefined));
    return true;
  } catch (e) {
    console.error("Auto compaction failed", e);
    dispatch(autoCompactionFailed());
    return false;
  }
}
