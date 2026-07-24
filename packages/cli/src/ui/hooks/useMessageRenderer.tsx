import React, { useCallback } from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { MemoizedMessage } from "../components/MemoizedMessage.js";
import {
  SPLIT_CONTINUATION,
  type SplitChatHistoryItem,
} from "../utils/historySplitting.js";

export function useMessageRenderer() {
  const renderMessage = useCallback(
    (
      item: ChatHistoryItem,
      index: number,
      _allMessages?: ChatHistoryItem[],
    ) => {
      const toolCallsKey = item.toolCallStates
        ? item.toolCallStates.map((tc) => tc.toolCallId).join("-")
        : "";

      // Only a chunk produced by splitting one message suppresses the prefix.
      // A second message with the same role is a new turn and keeps its own
      // marker, so a model answer after a tool round still reads as the model.
      const isContinuation = Boolean(
        (item as SplitChatHistoryItem)[SPLIT_CONTINUATION],
      );

      const uniqueKey = `${item.message.role}-${toolCallsKey}-${index}`;

      return (
        <MemoizedMessage
          key={uniqueKey}
          item={item}
          index={index}
          hideBullet={isContinuation}
        />
      );
    },
    [],
  );

  return { renderMessage };
}
