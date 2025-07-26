import type { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { Box, Static, Text } from "ink";
import React from "react";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import type { QueuedMessage } from "../../stream/messageQueue.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { IntroMessage } from "../IntroMessage.js";
import { splitChatHistory } from "../utils/historySplitting.js";
import { splitTranscriptSegments } from "../utils/transcriptSegments.js";

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
   * Trailing history items that are still changing and therefore cannot be
   * printed once: the answer being streamed, the tool call being run, the
   * message waiting on a permission prompt. They stay in the live frame; every
   * other item is final and is written to the terminal scrollback.
   */
  liveItemCount?: number;
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
  liveItemCount = 0,
}) => {
  const { columns } = useTerminalSize();

  // /clear remounts this subtree through the refresh trigger key, so the
  // printed state restarts from the banner instead of keeping the old
  // transcript in the live frame.

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

  // A transcript item is immutable once the answer it belongs to has finished,
  // so it is handed to Ink's <Static>, which prints it above the live frame and
  // never redraws it. That is what makes the log behave like terminal output:
  // finished messages scroll up into the scrollback and the newest lines stay
  // next to the composer, instead of the whole conversation being re-wrapped
  // inside a fixed-height box and clipped at the top.
  const settledItems = React.useMemo(() => {
    const items: React.ReactElement[] = [];

    if (showIntroMessage) {
      items.push(
        <IntroMessage
          key="intro"
          config={config}
          model={model}
          organizationName={organizationName}
        />,
      );
    }

    for (let index = 0; index < settled.length; index += 1) {
      items.push(renderMessage(settled[index], index, processedChatHistory));
    }

    return items;
  }, [
    showIntroMessage,
    config,
    model,
    organizationName,
    settled,
    processedChatHistory,
    renderMessage,
  ]);

  // The live frame: whatever is still being written, plus the message queue.
  // Kept out of <Static> because Ink may not redraw anything it has printed.
  const liveItems = React.useMemo(() => {
    const items: React.ReactElement[] = [];

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
  }, [live, settled.length, processedChatHistory, renderMessage]);

  return (
    <React.Fragment key={refreshTrigger ?? 0}>
      <Static items={settledItems}>{(item) => item}</Static>

      {/* Queued messages - show at bottom with queue indicators */}
      {(liveItems.length > 0 || queuedMessages.length > 0) && (
        <Box flexDirection="column" flexShrink={0}>
          {liveItems}

          {queuedMessages.length > 0 && (
            <Box paddingLeft={2} paddingBottom={1}>
              <Text color="dim" italic>
                {queuedMessages.map((msg) => msg.message).join("\n")}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </React.Fragment>
  );
};
