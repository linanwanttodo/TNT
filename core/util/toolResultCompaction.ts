import type { ChatHistoryItem, ChatMessage } from "../index.js";
import { BuiltInToolNames } from "../tools/builtIn.js";

export const TOOL_RESULT_TRUNCATION_MARKER =
  "\n[... middle of tool result omitted ...]\n";
export const DEFAULT_TOOL_RESULT_KEEP_RECENT = 5;
export const DEFAULT_TOOL_RESULT_HEAD_CHARS = 4096;
export const DEFAULT_TOOL_RESULT_TAIL_CHARS = 1024;

export interface ToolResultCompactionResult {
  messages: ChatMessage[];
  truncatedCount: number;
}

export interface ToolHistoryCompactionResult {
  history: ChatHistoryItem[];
  truncatedCount: number;
}

function isProtectedToolName(name: string | undefined): boolean {
  const words = (name ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const recoveryActions = [
    "fetch",
    "get",
    "load",
    "read",
    "recover",
    "restore",
    "retrieve",
  ];

  return (
    words.join("_") === BuiltInToolNames.ReadSkill ||
    (words.includes("artifact") &&
      recoveryActions.some((action) => words.includes(action)))
  );
}

function truncateToolResultContent(content: string): string | undefined {
  const codePoints = Array.from(content);
  const excerptLength =
    DEFAULT_TOOL_RESULT_HEAD_CHARS + DEFAULT_TOOL_RESULT_TAIL_CHARS;
  if (
    codePoints.length <= excerptLength ||
    content.includes(TOOL_RESULT_TRUNCATION_MARKER)
  ) {
    return undefined;
  }

  const candidate =
    codePoints.slice(0, DEFAULT_TOOL_RESULT_HEAD_CHARS).join("") +
    TOOL_RESULT_TRUNCATION_MARKER +
    codePoints.slice(-DEFAULT_TOOL_RESULT_TAIL_CHARS).join("");
  return Array.from(candidate).length < codePoints.length
    ? candidate
    : undefined;
}

function getProtectedToolCallIds(messages: ChatMessage[]): Set<string> {
  const protectedIds = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.id && isProtectedToolName(toolCall.function?.name)) {
        protectedIds.add(toolCall.id);
      }
    }
  }

  return protectedIds;
}

export function compactToolResults(
  messages: ChatMessage[],
  keepRecent: number = DEFAULT_TOOL_RESULT_KEEP_RECENT,
): ToolResultCompactionResult {
  let remaining = Math.max(0, keepRecent);
  let truncatedCount = 0;
  const result = messages.slice();
  const protectedToolCallIds = getProtectedToolCallIds(messages);

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "tool") {
      continue;
    }
    if (remaining > 0) {
      remaining--;
      continue;
    }
    if (
      message.content.startsWith("skill://") ||
      protectedToolCallIds.has(message.toolCallId) ||
      message.metadata?.preserveForCompaction === true
    ) {
      continue;
    }

    const truncated = truncateToolResultContent(message.content);
    if (truncated === undefined) {
      continue;
    }

    result[i] = { ...message, content: truncated };
    truncatedCount++;
  }

  return { messages: result, truncatedCount };
}

export function compactToolCallOutputs(
  history: ChatHistoryItem[],
  keepRecent: number = DEFAULT_TOOL_RESULT_KEEP_RECENT,
): ToolHistoryCompactionResult {
  let remaining = Math.max(0, keepRecent);
  let truncatedCount = 0;
  const result = history.slice();

  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    const states = item.toolCallStates;
    if (!states) {
      continue;
    }

    let nextStates = states;
    for (let j = states.length - 1; j >= 0; j--) {
      const state = states[j];
      const output = state.output;
      if (!output || output.length === 0) {
        continue;
      }
      if (remaining > 0) {
        remaining--;
        continue;
      }
      if (
        isProtectedToolName(state.toolCall.function.name) ||
        output.some(
          (entry) =>
            entry.content.startsWith("skill://") ||
            entry.uri?.value.startsWith("skill://"),
        )
      ) {
        continue;
      }

      const truncated = truncateToolResultContent(
        output.map((entry) => entry.content).join("\n"),
      );
      if (truncated === undefined) {
        continue;
      }

      if (nextStates === states) {
        nextStates = states.slice();
      }
      nextStates[j] = {
        ...state,
        output: output.map((entry, index) => ({
          ...entry,
          content: index === 0 ? truncated : "",
        })),
      };
      truncatedCount++;
    }

    if (nextStates !== states) {
      result[i] = { ...item, toolCallStates: nextStates };
    }
  }

  return { history: result, truncatedCount };
}
