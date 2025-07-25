import type { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { Box, Text } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { IntroMessage } from "../IntroMessage.js";
import { splitChatHistory } from "../utils/historySplitting.js";
import { estimateHistoryHeight } from "../utils/wrappedLineCount.js";

interface StaticChatContentProps {
  showIntroMessage: boolean;
  config?: AssistantUnrolled;
  model?: ModelConfig;
  organizationName?: string;
  chatHistory: ChatHistoryItem[];
  queuedMessages?: QueuedMessage[];
  renderMessage: (
    item: ChatHistoryItem,
    index: number,
    allMessages?: ChatHistoryItem[],
  ) => React.ReactElement;
  refreshTrigger?: number;
  /**
   * How many lines the transcript is scrolled up from the bottom. 0 means the
   * newest content is visible. The parent keeps this pinned to the bottom by
   * default and only allows it to grow when the user scrolls up.
   */
  scrollOffset?: number;
  /** Number of visible rows the viewport may occupy. */
  visibleRows?: number;
  /** Called when the user requests to jump back to the newest content. */
  onScrollToBottom?: () => void;
}

export const StaticChatContent: React.FC<StaticChatContentProps> = ({
  showIntroMessage,
  config,
  model,
  organizationName,
  chatHistory,
  queuedMessages = [],
  renderMessage,
  refreshTrigger,
  scrollOffset = 0,
  visibleRows,
  onScrollToBottom,
}) => {
  const { columns } = useTerminalSize();

  // /clear forces the transcript to remount by keying the content on the
  // refresh trigger, discarding any previously rendered history.

  // Filter out system messages without content and split large messages
  const processedChatHistory = React.useMemo(() => {
    const filtered = chatHistory.filter(
      (item) => item.message.role !== "system" || item.message.content,
    );

    // Split large messages into multiple history items
    return splitChatHistory(filtered, columns);
  }, [chatHistory, columns]);

  // Split chat history into stable and pending items
  // Keep more items static now that we've split large messages
  const { staticItems, pendingItems } = React.useMemo(() => {
    // Add intro message as first item if it should be shown
    const staticItems: React.ReactElement[] = [];
    if (showIntroMessage) {
      staticItems.push(
        <IntroMessage
          key="intro"
          config={config}
          model={model}
          organizationName={organizationName}
        />,
      );
    }

    // Since messages are now split into reasonably-sized chunks,
    // we can keep more items static (only last 1-2 items dynamic)
    const PENDING_ITEMS_COUNT = 1;
    const stableCount = Math.max(
      0,
      processedChatHistory.length - PENDING_ITEMS_COUNT,
    );
    const stableHistory = processedChatHistory.slice(0, stableCount);
    const pendingHistory = processedChatHistory.slice(stableCount);

    // Add stable messages to static items
    stableHistory.forEach((item, index) => {
      staticItems.push(renderMessage(item, index, processedChatHistory));
    });

    // Pending items will be rendered dynamically outside Static
    const pendingItems = pendingHistory.map((item, index) =>
      renderMessage(item, stableCount + index, processedChatHistory),
    );

    return {
      staticItems,
      pendingItems,
    };
  }, [
    showIntroMessage,
    config,
    model,
    organizationName,
    processedChatHistory,
    renderMessage,
  ]);

  return (
    <Box
      key={refreshTrigger ?? 0}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
    >
      {/* Leading spacer: scrollOffset blank lines push the history down so the
          visible window reveals older content when scrolled up. When offset is
          0 the newest content sits at the bottom of the viewport. */}
      {scrollOffset > 0 && (
        <Text>
          {Array.from({ length: scrollOffset }, () => " ").join("\n")}
        </Text>
      )}

      {staticItems.map((item, index) => (
        <React.Fragment key={`static-${index}`}>{item}</React.Fragment>
      ))}

      {pendingItems.map((item, index) => (
        <React.Fragment key={`pending-${index}`}>{item}</React.Fragment>
      ))}

      {/* Queued messages - show at bottom with queue indicators */}
      {queuedMessages.length > 0 && (
        <Box paddingLeft={2} paddingBottom={1}>
          <Text color="dim" italic>
            {queuedMessages.map((msg) => msg.message).join("\n")}
          </Text>
        </Box>
      )}
    </Box>
  );
};
