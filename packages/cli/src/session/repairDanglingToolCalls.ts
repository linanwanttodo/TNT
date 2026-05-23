import type {
  AssistantChatMessage,
  ChatHistoryItem,
  ContextItem,
  ToolCallState,
  ToolStatus,
} from "core/index.js";

/**
 * The fixed placeholder recorded for a tool call whose result never made it to
 * disk. A crash between the assistant message carrying the tool call and the
 * result patch leaves the call dangling, and a provider refuses a history
 * whose tool_calls are never answered, so the resume path closes every gap
 * with this sentence instead of replaying the broken transcript verbatim.
 */
export const INTERRUPTED_TOOL_RESULT_CONTENT =
  "Tool execution was interrupted before a result was recorded.";

/**
 * The status and result shape `services.chatHistory.addToolResult(id, content,
 * "errored")` writes for a call that failed; the repair records the same thing
 * for a call that never finished.
 */
const INTERRUPTED_STATUS: ToolStatus = "errored";

function interruptedOutput(): ContextItem[] {
  return [
    {
      content: INTERRUPTED_TOOL_RESULT_CONTENT,
      name: "Tool Result",
      description: "Tool execution result",
    },
  ];
}

function hasRecordedResult(state: ToolCallState): boolean {
  return Boolean(state.output && state.output.length > 0);
}

function tryParseArguments(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    // A call cut off mid-stream has unclosed JSON; keep the accumulated text
    // verbatim and leave the parse empty rather than guessing at arguments.
    return {};
  }
}

/** Every tool call id an assistant message declares, in declaration order. */
function declaredCallIds(
  message: AssistantChatMessage,
  states: ToolCallState[] | undefined,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const delta of message.toolCalls ?? []) {
    if (
      typeof delta?.id === "string" &&
      delta.id !== "" &&
      !seen.has(delta.id)
    ) {
      seen.add(delta.id);
      ids.push(delta.id);
    }
  }
  for (const state of states ?? []) {
    if (state.toolCallId && !seen.has(state.toolCallId)) {
      seen.add(state.toolCallId);
      ids.push(state.toolCallId);
    }
  }
  return ids;
}

/** The state a dangling call needs, built from what the stream accumulated. */
function interruptedState(
  message: AssistantChatMessage,
  toolCallId: string,
): ToolCallState {
  const delta = message.toolCalls?.find(
    (candidate) => candidate?.id === toolCallId,
  );
  const name = delta?.function?.name ?? "";
  // A partial call keeps the name and the raw arguments text it had; nothing
  // executes it, so the unclosed JSON is preserved as written.
  const argumentsText =
    typeof delta?.function?.arguments === "string"
      ? delta.function.arguments
      : "";
  return {
    toolCallId,
    toolCall: {
      id: toolCallId,
      type: "function",
      function: { name, arguments: argumentsText },
    },
    status: INTERRUPTED_STATUS,
    parsedArgs: tryParseArguments(argumentsText),
    output: interruptedOutput(),
  };
}

function withInterruptedResults(
  item: ChatHistoryItem & { message: AssistantChatMessage },
  danglingIds: string[],
): ChatHistoryItem {
  const states = [...(item.toolCallStates ?? [])];
  for (const toolCallId of danglingIds) {
    const index = states.findIndex((state) => state.toolCallId === toolCallId);
    if (index >= 0) {
      // The call itself (name, raw arguments, extra content) stays as written;
      // only the missing result is filled in.
      states[index] = {
        ...states[index],
        status: INTERRUPTED_STATUS,
        output: interruptedOutput(),
      };
    } else {
      states.push(interruptedState(item.message, toolCallId));
    }
  }
  return { ...item, toolCallStates: states };
}

/**
 * Closes every assistant tool call that reached the transcript without a
 * recorded result, so a resumed session is sent to the provider as a history
 * in which each tool call is answered.
 *
 * A result counts as recorded when a later tool message carries the call's id
 * or the call's own state holds an output. Anything else gets a synthetic
 * errored result with a fixed placeholder, mirroring what
 * `services.chatHistory.addToolResult(id, content, "errored")` writes; calls
 * that are already paired are returned untouched.
 */
export function repairDanglingToolCalls(
  history: ChatHistoryItem[],
): ChatHistoryItem[] {
  // First pass: collect every result id the history already carries, from
  // tool messages and from states that hold an output.
  const answered = new Set<string>();
  for (const item of history) {
    if (item.message.role === "tool") {
      const toolCallId = (item.message as { toolCallId?: string }).toolCallId;
      if (toolCallId) answered.add(toolCallId);
    }
    for (const state of item.toolCallStates ?? []) {
      if (hasRecordedResult(state)) answered.add(state.toolCallId);
    }
  }

  let changed = false;
  const repaired = history.map((item) => {
    if (item.message.role !== "assistant") {
      return item;
    }
    const message: AssistantChatMessage = item.message;
    const dangling = declaredCallIds(message, item.toolCallStates).filter(
      (id) => !answered.has(id),
    );
    if (dangling.length === 0) {
      return item;
    }
    changed = true;
    return withInterruptedResults({ ...item, message }, dangling);
  });

  // Nothing to repair: return the input unchanged so callers can rely on
  // reference equality for an already-clean history.
  return changed ? repaired : history;
}
