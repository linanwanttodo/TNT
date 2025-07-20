import { useContext, useEffect, useRef } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { autoCompactIfNeeded } from "../redux/thunks/autoCompaction";

/**
 * Summarizes the conversation between turns once it approaches the context
 * limit, so the next turn starts from a smaller window instead of dropping
 * messages. Driven from the UI rather than from the streaming thunks: it must
 * run only after a turn has fully settled, and only when a turn actually ends,
 * so a request in flight never races a rewrite of the history it is reading.
 */
export function useAutoCompaction() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const sessionId = useAppSelector((state) => state.session.id);
  const historyLength = useAppSelector((state) => state.session.history.length);
  const contextPercentage = useAppSelector(
    (state) => state.session.contextPercentage,
  );
  const autoCompactionState = useAppSelector(
    (state) => state.session.autoCompaction,
  );
  const wasStreaming = useRef(false);

  useEffect(() => {
    const justFinished = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;
    if (!justFinished) {
      return;
    }

    void autoCompactIfNeeded({
      dispatch,
      ideMessenger,
      sessionId,
      historyLength,
      contextPercentage,
      state: autoCompactionState,
    });
  }, [
    autoCompactionState,
    contextPercentage,
    dispatch,
    historyLength,
    ideMessenger,
    isStreaming,
    sessionId,
  ]);
}
