import type { ChatHistoryItem } from "core/index.js";
import { Box, type DOMElement, measureElement, Text, useInput } from "ink";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { t } from "../i18n/index.js";

import { ScrollBarColumn } from "./components/ScrollBarColumn.js";
import { defaultBoxStyles } from "./styles.js";
import { scrollbarGeometry } from "./utils/scrollbar.js";

interface SessionPreviewProps {
  chatHistory: ChatHistoryItem[];
  sessionTitle: string;
}

function formatMessageContent(content: string | any): string {
  if (typeof content === "string") {
    return content;
  } else if (Array.isArray(content)) {
    // For array content, find the first text part
    const textPart = content.find((part: any) => part.type === "text");
    return textPart && "text" in textPart
      ? textPart.text
      : "(multimodal message)";
  }
  return "(unknown content type)";
}

/**
 * The preview pane of the session selector: the whole conversation, laid out
 * in full and clipped to the pane, with a scrollbar and PageUp/PageDown for
 * the part that does not fit. Nothing here guesses how tall a message is -
 * the earlier fixed-height slice could only ever show the first few messages
 * of a long session.
 */
export function SessionPreview({
  chatHistory,
  sessionTitle,
}: SessionPreviewProps) {
  const viewportRef = useRef<DOMElement>(null);
  const contentRef = useRef<DOMElement>(null);
  const [metrics, setMetrics] = useState({
    contentHeight: 0,
    viewportHeight: 0,
  });
  const [scrollTop, setScrollTop] = useState(0);

  // A different selection replaces the content; the read starts from the top.
  useEffect(() => {
    setScrollTop(0);
  }, [chatHistory, sessionTitle]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const next = {
      contentHeight: measureElement(content).height,
      viewportHeight: measureElement(viewport).height,
    };
    setMetrics((previous) =>
      previous.contentHeight === next.contentHeight &&
      previous.viewportHeight === next.viewportHeight
        ? previous
        : next,
    );
  });

  const maxScrollTop = Math.max(
    0,
    metrics.contentHeight - metrics.viewportHeight,
  );
  const page = Math.max(1, metrics.viewportHeight - 1);

  // The selector's own handler owns the list keys; the preview only reads the
  // page keys, which no other surface on this screen consumes.
  useInput((input, key) => {
    if (key.pageUp) {
      setScrollTop((previous) => Math.max(0, previous - page));
    } else if (key.pageDown) {
      setScrollTop((previous) => Math.min(maxScrollTop, previous + page));
    }
  });

  const previewMessages = useMemo(() => {
    return chatHistory
      .filter((item) => {
        // Skip system messages
        if (item.message.role === "system") return false;

        // Skip empty assistant messages
        if (item.message.role === "assistant") {
          const content = formatMessageContent(item.message.content);
          if (!content || content.trim() === "") return false;
        }

        return true;
      })
      .map((item) => ({
        role: item.message.role,
        content: formatMessageContent(item.message.content),
      }));
  }, [chatHistory]);

  const clampedScrollTop = Math.min(scrollTop, maxScrollTop);
  const geometry = scrollbarGeometry(
    clampedScrollTop,
    metrics.viewportHeight,
    metrics.contentHeight,
  );

  if (previewMessages.length === 0) {
    return (
      <Box {...defaultBoxStyles("blue")} flexDirection="column" width="100%">
        <Text color="blue" bold>
          Preview
        </Text>
        <Text color="gray">(no messages)</Text>
      </Box>
    );
  }

  return (
    <Box {...defaultBoxStyles("blue")} flexDirection="column" width="100%">
      <Text color="blue" bold>
        {sessionTitle}
      </Text>
      <Text> </Text>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0}>
        <Box
          ref={viewportRef}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          overflowY="hidden"
        >
          <Box
            ref={contentRef}
            flexDirection="column"
            flexShrink={0}
            marginTop={-clampedScrollTop}
          >
            {previewMessages.map((msg, index) => {
              const roleColor = msg.role === "user" ? "green" : "cyan";
              const roleLabel =
                msg.role === "user" ? t("session.you") : t("session.assistant");

              return (
                <Box key={index} flexDirection="column" marginBottom={1}>
                  <Text color={roleColor} bold>
                    {roleLabel}:
                  </Text>
                  <Text>{msg.content}</Text>
                </Box>
              );
            })}
          </Box>
        </Box>
        <ScrollBarColumn geometry={geometry} />
      </Box>
    </Box>
  );
}
