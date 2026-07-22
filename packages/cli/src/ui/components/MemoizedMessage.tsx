import { Box, Text, type DOMElement } from "ink";
import React, { memo, useRef } from "react";

import type {
  ChatHistoryItem,
  ToolCallState,
} from "../../../../../core/index.js";
import { splitServedPrompt } from "../../utils/promptNotes.js";
import { extractThinkingContent } from "../../utils/thinkingTags.js";
import { requestComposerDraft } from "../composerDraft.js";
import { useClickRegion } from "../hooks/useClickRegion.js";
import { MarkdownRenderer } from "../MarkdownRenderer.js";
import { symbols } from "../symbols.js";
import { useTheme } from "../theme/tokens.js";
import { sanitizeTerminalText } from "../utils/terminalTextSafety.js";

import { CompactionBoundary } from "./CompactionBoundary.js";
import { HalfLinePaddedBox } from "./HalfLinePaddedBox.js";
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

/** A tool-only item sits tight between its neighbours, as in the reference CLI. */
/**
 * The user's own turn is editable in place: clicking the band hands the
 * original typed text back to the composer, the way recalling a queued
 * message does. The band is the target because it is the whole row.
 */
const ClickableUserTurn: React.FC<{
  text: string;
  children: React.ReactNode;
}> = ({ text, children }) => {
  const theme = useTheme();
  const bandRef = useRef<DOMElement>(null);
  useClickRegion(bandRef, () => {
    if (text) {
      requestComposerDraft(text);
    }
  });
  return (
    <Box ref={bandRef}>
      <HalfLinePaddedBox backgroundBaseColor={theme.background.composer}>
        {children}
      </HalfLinePaddedBox>
    </Box>
  );
};

function itemBottomMargin(input: {
  hasTools: boolean;
  hasContent: boolean;
  hasReasoning: boolean;
}): 0 | 1 {
  return input.hasTools && !input.hasContent && !input.hasReasoning ? 0 : 1;
}

export const MemoizedMessage = memo<MemoizedMessageProps>(
  ({ item, index }) => {
    const theme = useTheme();
    const { message, toolCallStates, conversationSummary } = item;
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const isAssistant = message.role === "assistant";

    // Handle system messages
    if (isSystem) {
      return (
        <Box key={index} marginBottom={1}>
          <Text color={theme.text.primary}>
            <Text color={theme.text.secondary}>{symbols().bullet} </Text>
            {sanitizeTerminalText(
              formatMessageContentForDisplay(message.content),
            )}
          </Text>
        </Box>
      );
    }

    // Handle conversation summary (compaction)
    if (conversationSummary) {
      return <CompactionBoundary key={index} summary={conversationSummary} />;
    }

    // The transcript stores what the model was served, which may lead with
    // hook notes; surfaces show what the user typed. The item's userText is
    // that text when the composer recorded it, and the marker split is the
    // fallback for items stored before the field existed.
    const rawFormattedContent = sanitizeTerminalText(
      isUser
        ? ((item as { userText?: string }).userText ??
            splitServedPrompt(formatMessageContentForDisplay(message.content))
              .userText)
        : formatMessageContentForDisplay(message.content),
    );
    const { thinking: extractedThought, cleanedText: cleanedBody } = isAssistant
      ? extractThinkingContent(rawFormattedContent)
      : { thinking: undefined, cleanedText: rawFormattedContent };

    const reasoningText = sanitizeTerminalText(
      (item as any).reasoning?.text ||
        (message as any).reasoning ||
        extractedThought ||
        "",
    );

    const formattedContent = isAssistant ? cleanedBody : rawFormattedContent;
    // Clicking the band hands back what was typed, never the served prompt.
    const userEditSource = isUser
      ? ((item as { userText?: string }).userText ??
        splitServedPrompt(formatMessageContentForDisplay(message.content))
          .userText)
      : "";
    const hasContent = formattedContent.length > 0;
    const hasTools = !!(toolCallStates && toolCallStates.length > 0);
    const isStreaming =
      isAssistant && !hasContent && !hasTools && !reasoningText;

    return (
      <Box
        key={index}
        flexDirection="column"
        marginBottom={itemBottomMargin({
          hasTools,
          hasContent,
          hasReasoning: reasoningText !== "",
        })}
      >
        {reasoningText ? (
          <Box marginBottom={hasContent || hasTools ? 1 : 0}>
            <ThinkingMessage thought={reasoningText} />
          </Box>
        ) : null}

        {(hasContent || isUser || isStreaming) &&
          (isUser ? (
            // The user's turn reads like the input box it was typed into: the
            // same solid surface band, the `>` pointer and the raw text.
            // Clicking it hands the text back to the composer for editing,
            // the same gesture the session selector uses to recall a queued
            // message.
            <ClickableUserTurn text={userEditSource}>
              <Box flexDirection="row" paddingX={1}>
                <Text color={theme.text.subtle}>{" > "}</Text>
                <Box flexGrow={1}>
                  <Text wrap="wrap" color={theme.text.primary}>
                    {formattedContent}
                  </Text>
                </Box>
              </Box>
            </ClickableUserTurn>
          ) : (
            <Box paddingLeft={1}>
              <MarkdownRenderer
                content={formattedContent}
                theme={theme.syntax}
              />
              {isStreaming && (
                <Text color={theme.text.secondary} dimColor>
                  ▋
                </Text>
              )}
            </Box>
          ))}

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
