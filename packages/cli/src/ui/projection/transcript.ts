import type {
  ChatHistoryItem,
  MessageContent,
  ToolCallState,
} from "core/index.js";

import { extractThinkingContent } from "../../utils/thinkingTags.js";

/**
 * One row the transcript renders. The projection is the only place that knows
 * how a provider or a stored history item becomes something on screen; the
 * components below render these rows and nothing else.
 *
 * Reasoning is carried separately from the answer so the view can fold it
 * without editing the text the model produced. A row may carry both, which is
 * what a turn with a reasoning block, an answer, and tool calls looks like.
 */
export type TranscriptRow =
  | { kind: "system"; key: string; content: string }
  | { kind: "compaction"; key: string; summary: string }
  | {
      kind: "message";
      key: string;
      role: "user" | "assistant";
      content: string;
      reasoning?: string;
      toolStates?: ToolCallState[];
      streaming: boolean;
      hideBullet: boolean;
    };

export interface ProjectMessageOptions {
  hideBullet?: boolean;
  /** Force the streaming marker, used for the live overlay item. */
  streaming?: boolean;
}

/**
 * Converts message content into the text a person reads. Parts that are not
 * text (images, pasted files) become stable placeholders rather than JSON.
 */
export function formatMessageContentForDisplay(
  content: MessageContent,
): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content);
  }

  let displayText = "";
  let imageCounter = 0;

  for (const part of content) {
    if (part.type === "text") {
      displayText += part.text;
    } else if (part.type === "imageUrl") {
      imageCounter++;
      displayText += `[Image #${imageCounter}]`;
    } else {
      displayText += JSON.stringify(part);
    }
  }

  return displayText;
}

/**
 * Projects one history item. Returns null for items that carry nothing to
 * show, such as an empty system message, so the caller can skip them without
 * repeating the rule.
 */
export function projectMessage(
  item: ChatHistoryItem,
  index: number,
  options: ProjectMessageOptions = {},
): TranscriptRow | null {
  const { message, toolCallStates, conversationSummary } = item;

  if (conversationSummary) {
    return {
      kind: "compaction",
      key: `compaction-${index}`,
      summary: conversationSummary,
    };
  }

  const rawText = formatMessageContentForDisplay(message.content);

  if (message.role === "system") {
    if (!rawText) {
      return null;
    }
    return { kind: "system", key: `system-${index}`, content: rawText };
  }

  // A provider that reports reasoning as its own message contributes only a
  // reasoning row; its text is the reasoning, not an answer.
  if (message.role === "thinking") {
    const reasoning = rawText.trim();
    if (!reasoning) {
      return null;
    }
    return {
      kind: "message",
      key: `thinking-${index}`,
      role: "assistant",
      content: "",
      reasoning,
      streaming: false,
      hideBullet: options.hideBullet ?? false,
    };
  }

  const tagged =
    message.role === "assistant"
      ? extractThinkingContent(rawText)
      : { thinking: undefined, cleanedText: rawText };
  const typedReasoning =
    item.reasoning?.text && item.reasoning.text.trim().length > 0
      ? item.reasoning.text.trim()
      : undefined;

  const toolStates =
    toolCallStates && toolCallStates.length > 0 ? toolCallStates : undefined;
  const streaming =
    options.streaming ??
    (message.role === "assistant" && rawText.length === 0 && !toolStates);

  return {
    kind: "message",
    key: `${message.role}-${index}`,
    role: message.role === "user" ? "user" : "assistant",
    content: tagged.cleanedText,
    reasoning: typedReasoning ?? tagged.thinking,
    toolStates,
    streaming,
    hideBullet: options.hideBullet ?? false,
  };
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
