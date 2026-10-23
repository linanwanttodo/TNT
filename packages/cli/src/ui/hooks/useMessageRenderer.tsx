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
      // Generate a unique key by combining message role, content hash, and timestamp
      // This provides a stable identifier that won't change during re-renders
      const messageContent =
        typeof item.message.content === "string"
          ? item.message.content
          : JSON.stringify(item.message.content);

      const toolCallsKey = item.toolCallStates
        ? item.toolCallStates.map((tc) => tc.toolCallId).join("-")
        : "";

      // Only a chunk produced by splitting one message suppresses the prefix.
      // A second message with the same role is a new turn and keeps its own
      // marker, so a model answer after a tool round still reads as the model.
      const isContinuation = Boolean(
        (item as SplitChatHistoryItem)[SPLIT_CONTINUATION],
      );

      const uniqueKey = `${item.message.role}-${messageContent.slice(0, 50)}-${toolCallsKey}-${index}`;

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
