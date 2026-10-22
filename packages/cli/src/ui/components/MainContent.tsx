import { Box } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";

import { ActionStatus } from "./ActionStatus.js";
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
  refreshTrigger: number;
  liveItemCount: number;
  streamingText: string | null;
  /** False while the reader is scrolled back; the tail stops updating. */
  following: boolean;
  isWaitingForResponse: boolean;
  responseStartTime: number | null;
  isCompacting: boolean;
  compactionStartTime: number | null;
  isBashToolRunning: boolean;
}

/**
 * The transcript area: the fixed-height, bottom-anchored viewport above the
 * dock, with the working indicator following the newest message instead of
 * hovering above the composer.
 */
export const MainContent: React.FC<MainContentProps> = ({
  showIntroMessage,
  chatHistory,
  queuedMessages,
  renderMessage,
  refreshTrigger,
  liveItemCount,
  streamingText,
  following,
  isWaitingForResponse,
  responseStartTime,
  isCompacting,
  compactionStartTime,
  isBashToolRunning,
}) => {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      overflowY="hidden"
      justifyContent="flex-end"
    >
      <TranscriptContent
        showIntroMessage={showIntroMessage}
        chatHistory={chatHistory}
        queuedMessages={queuedMessages}
        renderMessage={renderMessage}
        refreshTrigger={refreshTrigger}
        liveItemCount={following ? liveItemCount : 0}
        streamingText={following ? streamingText : null}
      />

      <ActionStatus
        visible={isWaitingForResponse && !!responseStartTime && following}
        startTime={responseStartTime || 0}
        message={t("action.thinking")}
        showSpinner={true}
        loadingColor="gray"
        additionalHint={isBashToolRunning ? t("action.background") : undefined}
      />

      <ActionStatus
        visible={isCompacting && !!compactionStartTime && following}
        startTime={compactionStartTime || 0}
        message={t("action.compacting")}
        showSpinner={true}
        loadingColor="grey"
      />
    </Box>
  );
};
