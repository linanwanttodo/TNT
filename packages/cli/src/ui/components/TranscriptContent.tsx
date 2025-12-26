import { Box, Text } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { IntroMessage } from "../IntroMessage.js";
import { splitChatHistory } from "../utils/historySplitting.js";
import { splitTranscriptSegments } from "../utils/transcriptSegments.js";

interface TranscriptContentProps {
  showIntroMessage: boolean;
  chatHistory: ChatHistoryItem[];
  queuedMessages?: QueuedMessage[];
  renderMessage: (
    item: ChatHistoryItem,
    index: number,
    allMessages?: ChatHistoryItem[],
  ) => React.ReactElement;
  refreshTrigger?: number;
  /**
   * Trailing history items that are still changing: the answer being streamed,
   * the tool call being run, the message waiting on a permission prompt. They
   * stay after the settled items so their position never jumps.
   */
  liveItemCount?: number;
}

/**
 * The transcript rendered inside the fixed-height viewport TUIChat owns: the
 * banner, finished messages, the live answer and the queued messages, in that
 * order. This component does not print to the scrollback and does not add a
 * spacer; the viewport decides where it starts and how much of it is visible.
 */
export const TranscriptContent: React.FC<TranscriptContentProps> = ({
  showIntroMessage,
  chatHistory,
  queuedMessages = [],
  renderMessage,
  refreshTrigger,
  liveItemCount = 0,
}) => {
  const { columns } = useTerminalSize();

  // Filter out system messages without content and split large messages
  const processedChatHistory = React.useMemo(() => {
    const filtered = chatHistory.filter(
      (item) => item.message.role !== "system" || item.message.content,
    );

    // Split large messages into multiple history items
    return splitChatHistory(filtered, columns);
  }, [chatHistory, columns]);

  const { settled, live } = React.useMemo(
    () => splitTranscriptSegments(processedChatHistory, liveItemCount),
    [processedChatHistory, liveItemCount],
  );

  const transcript = React.useMemo(() => {
    const items: React.ReactElement[] = [];

    if (showIntroMessage) {
      items.push(<IntroMessage key="intro" />);
    }

    for (let index = 0; index < settled.length; index += 1) {
      items.push(renderMessage(settled[index], index, processedChatHistory));
    }

    for (let index = 0; index < live.length; index += 1) {
      items.push(
        renderMessage(
          live[index],
          settled.length + index,
          processedChatHistory,
        ),
      );
    }

    return items;
  }, [showIntroMessage, settled, live, processedChatHistory, renderMessage]);

  return (
    <Box
      key={refreshTrigger ?? 0}
      flexDirection="column"
      flexShrink={0}
      paddingX={0}
    >
      {transcript}

      {queuedMessages.length > 0 && (
        <Box paddingLeft={2} paddingBottom={1}>
          <Text color="dim" italic>
            {queuedMessages.map((message) => message.message).join("\n")}
          </Text>
        </Box>
      )}
    </Box>
  );
};
