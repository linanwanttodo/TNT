import { Box, Text } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";
import { IntroMessage } from "../IntroMessage.js";
import { useRevealedText } from "../streamReveal.js";
import { useTheme } from "../theme/tokens.js";
import { sanitizeTerminalText } from "../utils/terminalTextSafety.js";

import { ActionStatus } from "./ActionStatus.js";
import { BackgroundTasksNotice } from "./BackgroundTasksIndicator.js";
import { QueuedMessages } from "./QueuedMessages.js";
import { ScrollView, type ScrollViewMetrics } from "./ScrollView.js";
import { ThinkingMessage } from "./ThinkingMessage.js";

interface TranscriptContentProps {
  showIntroMessage: boolean;
  chatHistory: ChatHistoryItem[];
  queuedMessages?: QueuedMessage[];
  renderMessage: (
    item: ChatHistoryItem,
    index: number,
    allMessages?: ChatHistoryItem[],
  ) => React.ReactElement;
  /** The answer arriving chunk by chunk, rendered from the stream overlay. */
  streamingText?: string | null;
  /** The reasoning arriving chunk by chunk, above the live answer. */
  streamingReasoning?: string | null;
  /** Rows hidden above the window. */
  scrollTop: number;
  onMetrics: (metrics: ScrollViewMetrics) => void;
  /** Draws the one-column scrollbar on the right edge of the window. */
  showScrollbar?: boolean;
  isWaitingForResponse: boolean;
  /** The finished turn's ledger, rendered under the answer. */
  turnSummary?: string;
  responseStartTime: number | null;
  isCompacting: boolean;
  compactionStartTime: number | null;
  isBashToolRunning: boolean;
  /** Shows the token counter before the 30 s gate. */
  verbose?: boolean;
}

/**
 * The conversation, drawn inside the app-owned viewport.
 *
 * The dock below it never moves, so the transcript is what scrolls. Every
 * message is rendered and measured; the ScrollView clips that column to the
 * rows the layout gives it. Nothing here guesses how tall a message will be,
 * which is what made a scroll land on a window that did not fill the screen.
 */
export const TranscriptContent: React.FC<TranscriptContentProps> = ({
  showIntroMessage,
  chatHistory,
  queuedMessages = [],
  renderMessage,
  streamingText,
  streamingReasoning,
  scrollTop,
  onMetrics,
  showScrollbar,
  isWaitingForResponse,
  turnSummary,
  responseStartTime,
  isCompacting,
  compactionStartTime,
  isBashToolRunning,
  verbose = false,
}) => {
  // The provider reports exact usage only at the end of a turn; while it
  // streams, the visible answer is the only signal. Four characters per token
  // is the usual estimate, and it keeps the counter moving with output. The
  // streamed reasoning counts too, so a turn that is still thinking already
  // shows the consumption instead of a bare timer.
  const streamingTokens =
    streamingText || streamingReasoning
      ? Math.round(
          ((streamingText?.length ?? 0) + (streamingReasoning?.length ?? 0)) /
            4,
        )
      : 0;

  const processedChatHistory = React.useMemo(
    () =>
      chatHistory.filter(
        (item) => item.message.role !== "system" || item.message.content,
      ),
    [chatHistory],
  );

  // The header belongs to the transcript, as in the reference CLI: it stays
  // above the first answer and scrolls up as the conversation grows instead
  // of vanishing when the reader sends something.
  const showIntro = showIntroMessage;

  // One Markdown component owns the whole reply, so paragraph boundaries and
  // code fences do not become separate messages with their own margins.
  const liveText = useRevealedText(streamingText ?? null);
  const streamingItem = React.useMemo(() => {
    if (!liveText) return null;

    return renderMessage(
      {
        message: { role: "assistant", content: liveText, isStreaming: true },
        contextItems: [],
      } as ChatHistoryItem,
      processedChatHistory.length,
      processedChatHistory,
    );
  }, [liveText, processedChatHistory, renderMessage]);

  const theme = useTheme();

  const live = (
    <>
      {streamingReasoning && (
        <ThinkingMessage thought={streamingReasoning} isStreaming />
      )}

      {streamingItem}

      <QueuedMessages messages={queuedMessages} />

      <BackgroundTasksNotice />

      {/* The indicator is the last row of the transcript, so it sits directly
          under the newest message no matter how tall the viewport is. */}
      <ActionStatus
        visible={isWaitingForResponse && !!responseStartTime}
        startTime={responseStartTime || 0}
        message={t("action.thinking")}
        showSpinner={true}
        loadingColor="gray"
        tokenCount={streamingTokens}
        tokenRate={
          responseStartTime && isWaitingForResponse
            ? streamingTokens /
              Math.max(1, (Date.now() - responseStartTime) / 1000)
            : undefined
        }
        verbose={verbose}
        hasActiveTools={isBashToolRunning}
        cancelHint={t("composer.interruptHint")}
        additionalHint={isBashToolRunning ? t("action.background") : undefined}
      />

      {/* The turn's own ledger, shown once the turn ends: what it read, what
          it wrote, how long it took and what the cache did. */}
      {turnSummary ? (
        <Box paddingX={1}>
          <Text color={theme.text.secondary} italic>
            {sanitizeTerminalText(turnSummary)}
          </Text>
        </Box>
      ) : null}

      <ActionStatus
        visible={isCompacting && !!compactionStartTime}
        startTime={compactionStartTime || 0}
        message={t("action.compacting")}
        showSpinner={true}
        loadingColor="grey"
      />
    </>
  );

  const history = processedChatHistory.map((item, index) => (
    <React.Fragment key={`history-${index}`}>
      {renderMessage(item, index, processedChatHistory)}
    </React.Fragment>
  ));

  // Both buffers share one viewport: the frame is screen-sized, the dock
  // below the transcript never moves, and the ScrollView clips the column to
  // the rows the layout gives it. Wheel scrolling and clicks are handled by
  // the app, so folded thoughts stay clickable while the reader scrolls.
  return (
    <ScrollView
      scrollTop={scrollTop}
      onMetrics={onMetrics}
      showScrollbar={showScrollbar}
    >
      {showIntro && <IntroMessage />}
      {history}
      {live}
    </ScrollView>
  );
};
