import { Box } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";

import type { ScrollViewMetrics } from "./ScrollView.js";
import { TranscriptContent } from "./TranscriptContent.js";

interface MainContentProps {
  showIntroMessage: boolean;
  chatHistory: ChatHistoryItem[];
  queuedMessages: QueuedMessage[];
  renderMessage: (
    item: ChatHistoryItem,
    index: number,
    allMessages?: ChatHistoryItem[],
  ) => React.ReactElement;
  streamingText: string | null;
  streamingReasoning: string | null;
  isWaitingForResponse: boolean;
  responseStartTime: number | null;
  isCompacting: boolean;
  compactionStartTime: number | null;
  isBashToolRunning: boolean;
  /** Rows hidden above the transcript window. */
  scrollTop: number;
  onScrollMetrics: (metrics: ScrollViewMetrics) => void;
}

/**
 * The transcript area, inside the app-owned screen.
 *
 * It takes whatever height the dock leaves. It is not a fixed height computed
 * from a reserve constant: the root frame is the terminal's height, the dock
 * keeps its natural height and this box grows into the rest. The working
 * indicator is part of the transcript content, so it always sits directly
 * under the newest row instead of under the leftover space of the viewport.
 */
export const MainContent: React.FC<MainContentProps> = ({
  showIntroMessage,
  chatHistory,
  queuedMessages,
  renderMessage,
  streamingText,
  streamingReasoning,
  isWaitingForResponse,
  responseStartTime,
  isCompacting,
  compactionStartTime,
  isBashToolRunning,
  scrollTop,
  onScrollMetrics,
}) => {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      overflowY="hidden"
    >
      <TranscriptContent
        showIntroMessage={showIntroMessage}
        chatHistory={chatHistory}
        queuedMessages={queuedMessages}
        renderMessage={renderMessage}
        streamingText={streamingText}
        streamingReasoning={streamingReasoning}
        isWaitingForResponse={isWaitingForResponse}
        responseStartTime={responseStartTime}
        isCompacting={isCompacting}
        compactionStartTime={compactionStartTime}
        isBashToolRunning={isBashToolRunning}
        scrollTop={scrollTop}
        onMetrics={onScrollMetrics}
      />
    </Box>
  );
};
