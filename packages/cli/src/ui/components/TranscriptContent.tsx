import { Box, Text } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { t } from "../../i18n/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useTurnProgress } from "../hooks/useTurnProgress.js";
import { IntroMessage } from "../IntroMessage.js";
import { useRevealedText } from "../streamReveal.js";
import { useTheme } from "../theme/tokens.js";
import { sanitizeTerminalText } from "../utils/terminalTextSafety.js";

import { ActionStatus } from "./ActionStatus.js";
import { BackgroundTasksNotice } from "./BackgroundTasksIndicator.js";
import { QueuedMessages } from "./QueuedMessages.js";
import type { ScrollViewMetrics } from "./ScrollView.js";
import { ThinkingMessage } from "./ThinkingMessage.js";
import { VirtualTranscript, type VirtualItem } from "./VirtualTranscript.js";

/** Rows a block of text occupies once wrapped to `width` columns. */
function wrappedRows(text: string, width: number): number {
  if (!text) return 0;
  const explicit = text.split("\n").length;
  const wrapped = Math.ceil(text.length / Math.max(1, width));
  return Math.max(explicit, wrapped);
}

function contentRows(content: ChatHistoryItem["message"]["content"]): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce(
    (total, part) => total + (part.type === "text" ? part.text.length : 1),
    0,
  );
}

/**
 * A cheap first guess at a message's height, replaced by the measured height
 * as soon as the item is on screen. It only has to decide which nodes to
 * mount, so tool output is capped rather than measured exactly.
 */
function estimateRows(item: ChatHistoryItem, width: number): number {
  const chars = contentRows(item.message.content);
  const reasoning = (item as { reasoning?: { text?: string } }).reasoning?.text;
  let rows =
    2 +
    wrappedRows("x".repeat(chars), width) +
    wrappedRows(reasoning ?? "", width);

  for (const state of item.toolCallStates ?? []) {
    const output = (state.output ?? []).reduce(
      (total, part) => total + part.content.length,
      0,
    );
    rows += 1 + Math.min(12, Math.ceil(output / Math.max(1, width)));
  }

  return Math.max(1, Math.min(4000, rows));
}

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
  /** Compensates the offset when a measured height replaces an estimate. */
  onContentShift?: (rows: number) => void;
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
  onContentShift,
  showScrollbar,
  isWaitingForResponse,
  turnSummary,
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

  const turnProgress = useTurnProgress({
    isWaiting: isWaitingForResponse,
    responseStartTime,
    chatHistory,
    streamingTokens,
  });
  const elapsedSeconds =
    responseStartTime && isWaitingForResponse
      ? Math.max(1, (Date.now() - responseStartTime) / 1000)
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

  // The live overlay changes on every streamed chunk; a scroll tick must not
  // rebuild it. Memoizing on the values it actually paints means a wheel notch
  // reuses the committed subtree instead of re-rendering the streaming answer.
  const live = React.useMemo(
    () => (
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
            turnProgress && elapsedSeconds > 0
              ? turnProgress.outputTokens / elapsedSeconds
              : undefined
          }
          turnProgress={turnProgress}
          verbose={verbose}
          hasActiveTools={isBashToolRunning}
          cancelHint={t("composer.interruptHint")}
          additionalHint={
            isBashToolRunning ? t("action.background") : undefined
          }
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
          cancelHint={t("composer.interruptHint")}
        />
      </>
    ),
    [
      streamingReasoning,
      streamingItem,
      queuedMessages,
      isWaitingForResponse,
      responseStartTime,
      streamingTokens,
      verbose,
      isBashToolRunning,
      turnSummary,
      isCompacting,
      compactionStartTime,
      theme,
    ],
  );

  // History rows are rebuilt only when the history or the width changes.
  // The live overlay below is a fresh element on every render (streaming
  // deltas, wheel notches, spinner ticks), so keeping it in this memo's
  // dependencies would rebuild every row's node each frame and put the whole
  // transcript back on the per-frame render path.
  const historyItems = React.useMemo(() => {
    const width = Math.max(20, columns - 4);
    const list: VirtualItem[] = [];
    if (showIntro) {
      list.push({ key: "intro", node: <IntroMessage />, estimate: 8 });
    }
    processedChatHistory.forEach((item, index) => {
      const messageId = (item as ChatHistoryItem & { messageId?: string })
        .messageId;
      list.push({
        key: messageId ?? `history-${index}`,
        node: renderMessage(item, index, processedChatHistory),
        estimate: estimateRows(item, width),
      });
    });
    return list;
  }, [columns, processedChatHistory, renderMessage, showIntro]);

  const liveItem = React.useMemo(
    () => ({
      key: "live",
      node: live,
      estimate:
        4 +
        wrappedRows(streamingText ?? "", Math.max(20, columns - 4)) +
        wrappedRows(streamingReasoning ?? "", Math.max(20, columns - 4)) +
        queuedMessages.length,
    }),
    [columns, live, queuedMessages.length, streamingReasoning, streamingText],
  );

  const items = React.useMemo(
    () => [...historyItems, liveItem],
    [historyItems, liveItem],
  );

  return (
    <VirtualTranscript
      items={items}
      scrollTop={scrollTop}
      onMetrics={onMetrics}
      onContentShift={onContentShift}
      showScrollbar={showScrollbar}
      width={columns}
    />
  );
};
