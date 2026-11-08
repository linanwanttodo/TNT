import type { ChatHistoryItem } from "core/index.js";
import { convertFromUnifiedHistory } from "core/util/messageConversion.js";
import type { ChatCompletionMessageParam } from "openai/resources.mjs";

/**
 * How an in-history update is announced. The update is a user-role fragment
 * rather than a second system message: OpenAI-compatible servers may hoist or
 * drop a mid-history system message, and Anthropic lifts only the first system
 * message into its system field, so anything after it would disappear. The
 * wrapper keeps the fragment legible as machine state rather than as something
 * the user typed.
 */
const UPDATE_OPEN = "<system-update>";
const UPDATE_CLOSE = "</system-update>";

export function formatInHistoryUpdate(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" ? "" : `${UPDATE_OPEN}\n${trimmed}\n${UPDATE_CLOSE}`;
}

export interface InHistoryUpdate {
  readonly text: string;
  /** Insert before this history item. Values past the end land at the end. */
  readonly at: number;
}

export interface ComposeRequestMessagesOptions {
  readonly chatHistory: ChatHistoryItem[];
  readonly systemMessage: string;
  /**
   * Updates with the history position each was produced at. The position is
   * what makes the bytes append-only: an update produced before a round stays
   * ahead of the messages that round and later rounds add, instead of being
   * pushed after the whole history and rebilled at a new offset.
   */
  readonly updates?: readonly InHistoryUpdate[];
  /**
   * The session's environment snapshot, delivered as the head of the first
   * user message. It used to live in the system field, where a changed working
   * directory or date rewrote the field every request started from.
   */
  readonly environmentContext?: string;
}

function prependEnvironment(
  message: ChatCompletionMessageParam,
  environmentContext: string,
): ChatCompletionMessageParam {
  if (typeof message.content === "string") {
    return {
      ...message,
      content: `${environmentContext}\n\n${message.content}`,
    };
  }
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [
        { type: "text", text: environmentContext },
        ...(message.content as unknown[]),
      ] as never,
    };
  }
  return message;
}

/**
 * Build the wire messages for one request from the unified history plus the
 * system field, its in-history updates and the environment snapshot.
 */
export function composeRequestMessages(
  options: ComposeRequestMessagesOptions,
): ChatCompletionMessageParam[] {
  const {
    chatHistory,
    systemMessage,
    updates = [],
    environmentContext,
  } = options;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
  ];

  // Updates are grouped by anchor so one pass over the history can interleave
  // them at the positions they were produced at. Missing anchors and values
  // beyond the current window fall at the end, which is the old tail-append
  // behavior and the only safe place when the history was pruned underneath.
  const updatesByAnchor = new Map<number, string[]>();
  for (const update of updates) {
    const text = formatInHistoryUpdate(update.text);
    if (text === "") continue;
    const at = Math.max(0, Math.min(update.at, chatHistory.length));
    const bucket = updatesByAnchor.get(at);
    if (bucket) {
      bucket.push(text);
    } else {
      updatesByAnchor.set(at, [text]);
    }
  }

  let environmentDelivered = environmentContext === undefined;
  const deliverEnvironmentIfNeeded = (): void => {
    if (environmentDelivered || environmentContext === undefined) return;
    messages.push({ role: "user", content: environmentContext });
    environmentDelivered = true;
  };

  for (let index = 0; index <= chatHistory.length; index++) {
    if (index === chatHistory.length) {
      // The end is both an anchor for updates produced against the current
      // tail and the fallback for an environment with no user message to
      // travel in.
      deliverEnvironmentIfNeeded();
    }

    for (const text of updatesByAnchor.get(index) ?? []) {
      messages.push({ role: "user", content: text });
    }
    if (index === chatHistory.length) break;

    const conversion = convertFromUnifiedHistory([
      chatHistory[index],
    ]) as unknown as ChatCompletionMessageParam[];
    if (!environmentDelivered && chatHistory[index].message.role === "user") {
      const firstUser = conversion.findIndex(
        (message) => message.role === "user",
      );
      if (firstUser >= 0) {
        conversion[firstUser] = prependEnvironment(
          conversion[firstUser],
          environmentContext as string,
        );
        environmentDelivered = true;
      }
    }
    messages.push(...conversion);
  }

  return messages;
}
