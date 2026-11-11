import { Box, Static } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { IntroMessage } from "../IntroMessage.js";
import { useRevealedText } from "../streamReveal.js";
import { splitChatHistory } from "../utils/historySplitting.js";
import { findLastSafeSplitPoint } from "../utils/streamSplit.js";
import { alternateScreenEnabled } from "../utils/terminalScreen.js";

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
  responseStartTime: number | null;
  isCompacting: boolean;
  compactionStartTime: number | null;
  isBashToolRunning: boolean;
  /** Shows the token counter before the 30 s gate. */
  verbose?: boolean;
}

/**
 * The conversation, drawn inside the app-owned alternate screen.
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
  responseStartTime,
  isCompacting,
  compactionStartTime,
  isBashToolRunning,
  verbose = false,
}) => {
  const { columns } = useTerminalSize();

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

  // Filter out system messages without content and split large messages.
  const processedChatHistory = React.useMemo(() => {
    const filtered = chatHistory.filter(
      (item) => item.message.role !== "system" || item.message.content,
    );

    return splitChatHistory(filtered, columns);
  }, [chatHistory, columns]);

  // The header belongs to the transcript, as in the reference CLI: it stays
  // above the first answer and scrolls up as the conversation grows instead
  // of vanishing when the reader sends something.
  const showIntro = showIntroMessage;

  // A long answer is split at the last safe boundary and the settled prefix is
  // rendered once. Only the tail keeps redrawing, which is both the flicker
  // fix and what lets the Static path write completed text to the terminal.
  const [settledChunks, setSettledChunks] = React.useState<string[]>([]);
  const settledOffset = React.useRef(0);
  React.useEffect(() => {
    if (!streamingText) {
      settledOffset.current = 0;
      setSettledChunks((current) => (current.length === 0 ? current : []));
      return;
    }
    if (streamingText.length < settledOffset.current) {
      settledOffset.current = 0;
      setSettledChunks([]);
    }
    const split = findLastSafeSplitPoint(streamingText);
    if (split > settledOffset.current && split < streamingText.length) {
      const chunk = streamingText.slice(settledOffset.current, split);
      settledOffset.current = split;
      setSettledChunks((current) => [...current, chunk]);
    }
  }, [streamingText]);

  const liveText = useRevealedText(
    streamingText ? streamingText.slice(settledOffset.current) : null,
  );

  // The live answer is not in the history yet, so it renders straight from the
  // stream overlay, after everything that has already arrived.
  const streamingItem = React.useMemo(() => {
    if (!liveText) return null;

    return renderMessage(
      {
        message: { role: "assistant", content: liveText },
        contextItems: [],
      } as ChatHistoryItem,
      processedChatHistory.length + settledChunks.length,
      processedChatHistory,
    );
  }, [liveText, settledChunks.length, processedChatHistory, renderMessage]);

  const settledStream = settledChunks.map((chunk, index) => (
    <React.Fragment key={`stream-${index}`}>
      {renderMessage(
        {
          message: { role: "assistant", content: chunk },
          contextItems: [],
        } as ChatHistoryItem,
        processedChatHistory.length + index,
        processedChatHistory,
      )}
    </React.Fragment>
  ));

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
        verbose={verbose}
        hasActiveTools={isBashToolRunning}
        additionalHint={
          [
            t("composer.interruptHint"),
            isBashToolRunning ? t("action.background") : null,
          ]
            .filter(Boolean)
            .join("  ") || undefined
        }
      />

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

  if (!alternateScreenEnabled()) {
    // The normal buffer gives the terminal its scrollback: settled rows are
    // written once through Static, and only the live tail is redrawn.
    return (
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
        <Static
          items={[
            ...(showIntro ? [<IntroMessage key="intro" />] : []),
            ...history,
            ...settledStream,
          ]}
        >
          {(item) => item}
        </Static>
        {live}
      </Box>
    );
  }

  return (
    <ScrollView
      scrollTop={scrollTop}
      onMetrics={onMetrics}
      showScrollbar={showScrollbar}
    >
      {showIntro && <IntroMessage />}
      {history}
      {settledStream}
      {live}
    </ScrollView>
  );
};
