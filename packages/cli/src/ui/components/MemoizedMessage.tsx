import { Box, Text } from "ink";
import React, { memo } from "react";

import type {
  ChatHistoryItem,
  ToolCallState,
} from "../../../../../core/index.js";
import { extractThinkingContent } from "../../utils/thinkingTags.js";
import { MarkdownRenderer } from "../MarkdownRenderer.js";
import { useTheme } from "../theme/tokens.js";

import { CompactionBoundary } from "./CompactionBoundary.js";
import { ThinkingMessage } from "./ThinkingMessage.js";
import { ToolGroupDisplay } from "./ToolGroupDisplay.js";

/**
 * Formats message content for display, converting message parts array back to
 * user-friendly format with placeholders like [Image #1], [Pasted Text #1], etc.
 */
function formatMessageContentForDisplay(
  content: import("../../../../../core/index.js").MessageContent,
): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content);
  }

  // Convert message parts array back to display format with placeholders
  let displayText = "";
  let imageCounter = 0;

  for (const part of content) {
    if (part.type === "text") {
      displayText += part.text;
    } else if (part.type === "imageUrl") {
      imageCounter++;
      displayText += `[Image #${imageCounter}]`;
    } else {
      // Handle any other part types by converting to JSON
      displayText += JSON.stringify(part);
    }
  }

  return displayText;
}

/**
 * The part of a tool state this component actually renders, as one string.
 *
 * The memo comparator used to serialize the entire state, which put the size of
 * every tool result on the critical path of each frame of a streamed turn. Output
 * is counted here rather than read, because it is the only field nobody can
 * bound - and a result arrives once, it is not rewritten in place.
 */
export function toolStateSignature(
  states: ToolCallState[] | undefined,
): string {
  if (!states || states.length === 0) return "";

  let signature = "";
  for (const state of states) {
    let outputChars = 0;
    for (const item of state.output ?? []) {
      outputChars += item.content.length;
    }

    signature +=
      `${state.toolCallId}:${state.status}:` +
      `${state.toolCall.function.name}:` +
      `${JSON.stringify(state.parsedArgs ?? null)}:${outputChars};`;
  }

  return signature;
}

interface MemoizedMessageProps {
  item: ChatHistoryItem;
  index: number;
  hideBullet?: boolean;
}

export const MemoizedMessage = memo<MemoizedMessageProps>(
  ({ item, index, hideBullet = false }) => {
    const theme = useTheme();
    const { message, toolCallStates, conversationSummary } = item;
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const isAssistant = message.role === "assistant";

    // Handle system messages
    if (isSystem) {
      return (
        <Box key={index} marginBottom={1}>
          <Text color={theme.text.secondary} dimColor italic>
            {message.content}
          </Text>
        </Box>
      );
    }

    // Handle conversation summary (compaction)
    if (conversationSummary) {
      return <CompactionBoundary key={index} summary={conversationSummary} />;
    }

    const rawFormattedContent = formatMessageContentForDisplay(message.content);
    const { thinking: extractedThought, cleanedText: cleanedBody } = isAssistant
      ? extractThinkingContent(rawFormattedContent)
      : { thinking: undefined, cleanedText: rawFormattedContent };

    const reasoningText =
      (item as any).reasoning?.text ||
      (message as any).reasoning ||
      extractedThought ||
      "";

    const formattedContent = isAssistant ? cleanedBody : rawFormattedContent;
    const hasContent = formattedContent.length > 0;
    const hasTools = !!(toolCallStates && toolCallStates.length > 0);
    const isStreaming =
      isAssistant && !hasContent && !hasTools && !reasoningText;

    return (
      <Box key={index} flexDirection="column" marginBottom={1}>
        {reasoningText ? (
          <Box marginBottom={hasContent || hasTools ? 1 : 0}>
            <ThinkingMessage thought={reasoningText} />
          </Box>
        ) : null}

        {(hasContent || isUser || isStreaming) && (
          <Box>
            <Text color={isUser ? theme.user : theme.accent}>
              {hideBullet ? " " : isUser ? ">" : "✦"}
            </Text>
            <Text> </Text>
            {isUser ? (
              <Text color={theme.text.primary}>{formattedContent}</Text>
            ) : (
              <MarkdownRenderer
                content={formattedContent}
                theme={theme.syntax}
              />
            )}
            {isStreaming && (
              <Text color={theme.text.secondary} dimColor>
                ▋
              </Text>
            )}
          </Box>
        )}

        {hasTools && <ToolGroupDisplay toolStates={toolCallStates} />}
      </Box>
    );
  },
  (prevProps, nextProps) => {
    const prevMessage = prevProps.item.message;
    const nextMessage = nextProps.item.message;
    const prevToolStates = prevProps.item.toolCallStates;
    const nextToolStates = nextProps.item.toolCallStates;
    const prevReasoning =
      (prevProps.item as any).reasoning?.text ||
      (prevMessage as any).reasoning ||
      "";
    const nextReasoning =
      (nextProps.item as any).reasoning?.text ||
      (nextMessage as any).reasoning ||
      "";

    return (
      prevMessage.content === nextMessage.content &&
      prevMessage.role === nextMessage.role &&
      prevReasoning === nextReasoning &&
      toolStateSignature(prevToolStates) ===
        toolStateSignature(nextToolStates) &&
      prevProps.item.conversationSummary ===
        nextProps.item.conversationSummary &&
      prevProps.index === nextProps.index &&
      prevProps.hideBullet === nextProps.hideBullet
    );
  },
);

MemoizedMessage.displayName = "MemoizedMessage";
