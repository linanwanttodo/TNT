import type { ChatHistoryItem, ContextItemWithId } from "core/index.js";

import { services } from "../services/index.js";

import type { Tool } from "./types.js";

export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

export interface TodoDetails {
  action: "list" | "add" | "toggle" | "clear";
  todos: Todo[];
  nextId: number;
  error?: string;
}

const DETAILS_PREFIX = "tnt-todo:";
const TODO_TOOL_NAME = "Todo";

/**
 * Todo state lives in the tool result of each todo call rather than in a
 * side file. Replaying the branch and applying the latest payload therefore
 * reconstructs exactly the list that was current at that point in history,
 * which keeps forked and resumed sessions consistent. Compaction carries the
 * state forward as a context item in the same payload format, so the replay
 * still finds it after the tool calls it came from were summarized away.
 */
export function readTodoState(
  history: ChatHistoryItem[] = services.chatHistory?.getHistory?.() ?? [],
): { todos: Todo[]; nextId: number } {
  let todos: Todo[] = [];
  let nextId = 1;

  const applyPayload = (content: unknown): void => {
    if (typeof content !== "string") {
      return;
    }
    const markerIndex = content.indexOf(DETAILS_PREFIX);
    if (markerIndex === -1) {
      return;
    }
    try {
      const details = JSON.parse(
        content.slice(markerIndex + DETAILS_PREFIX.length),
      ) as TodoDetails;
      if (Array.isArray(details.todos)) {
        todos = details.todos;
        nextId = details.nextId ?? nextId;
      }
    } catch {
      // A malformed payload should not break the rest of the replay.
    }
  };

  for (const item of history) {
    for (const contextItem of item.contextItems ?? []) {
      applyPayload(contextItem.content);
    }
    for (const toolCallState of item.toolCallStates ?? []) {
      if (toolCallState.toolCall?.function?.name !== TODO_TOOL_NAME) {
        continue;
      }
      for (const output of toolCallState.output ?? []) {
        applyPayload(output.content);
      }
    }
  }

  return { todos, nextId };
}

function formatTodos(todos: Todo[]): string {
  if (todos.length === 0) {
    return "No todos";
  }
  return todos
    .map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`)
    .join("\n");
}

function serialize(
  action: TodoDetails["action"],
  todos: Todo[],
  nextId: number,
  text: string,
  error?: string,
): string {
  const details: TodoDetails = { action, todos, nextId };
  if (error) {
    details.error = error;
  }
  return `${text}\n\n${DETAILS_PREFIX}${JSON.stringify(details)}`;
}

/**
 * The todo list, in the same payload format a Todo call produces, for a
 * caller that is about to drop the history the list was replayed from -
 * compaction attaches this to its summary message. Without it the list is
 * lost the moment the last Todo result is summarized away, since a replay
 * over the compacted history finds nothing. An empty list carries nothing.
 */
export function buildTodoCarryContextItem(
  todos: Todo[],
  nextId: number,
): ContextItemWithId | undefined {
  if (todos.length === 0) {
    return undefined;
  }
  return {
    id: { providerTitle: "todo", itemId: "todo-state" },
    name: "todo-state",
    description:
      "The todo list as it stood when the conversation was compacted",
    content: serialize(
      "list",
      todos,
      nextId,
      `Current todo list:\n${formatTodos(todos)}`,
    ),
  };
}

export const todoTool: Tool = {
  name: TODO_TOOL_NAME,
  displayName: "Todo",
  description: `Manage the todo list for the current task. Actions: list, add (text), toggle (id), clear.
Use this to plan multi-step work and to keep the user informed about progress.
In plan mode, use it to record the implementation plan as todos.
WHEN TO USE IT: work with three or more steps. A single trivial task does not need a list, and neither does a question you can just answer.
WHEN TO UPDATE IT: keep exactly one item in_progress - two means the list is not telling the truth. Do not mark an item completed while its test still fails, its implementation is partial, or you have not verified the result; fix that item or reopen it instead.`,
  readonly: true,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list", "add", "toggle", "clear"],
        description: "The operation to perform",
      },
      text: {
        type: "string",
        description: "Todo text (required for add)",
      },
      id: {
        type: "number",
        description: "Todo id (required for toggle)",
      },
    },
  },
  run: async (args: {
    action: TodoDetails["action"];
    text?: string;
    id?: number;
  }): Promise<string> => {
    const { todos, nextId } = readTodoState();

    switch (args.action) {
      case "add": {
        if (!args.text) {
          return serialize(
            "add",
            todos,
            nextId,
            "Error: text required for add",
            "text required",
          );
        }
        const created: Todo = { id: nextId, text: args.text, done: false };
        const updated = [...todos, created];
        return serialize(
          "add",
          updated,
          nextId + 1,
          `Added todo #${created.id}: ${created.text}`,
        );
      }

      case "toggle": {
        if (args.id === undefined) {
          return serialize(
            "toggle",
            todos,
            nextId,
            "Error: id required for toggle",
            "id required",
          );
        }
        if (!todos.some((todo) => todo.id === args.id)) {
          return serialize(
            "toggle",
            todos,
            nextId,
            `Todo #${args.id} not found`,
            `#${args.id} not found`,
          );
        }
        const updated = todos.map((todo) =>
          todo.id === args.id ? { ...todo, done: !todo.done } : todo,
        );
        const target = updated.find((todo) => todo.id === args.id)!;
        return serialize(
          "toggle",
          updated,
          nextId,
          `Todo #${target.id} ${target.done ? "completed" : "uncompleted"}`,
        );
      }

      case "clear": {
        return serialize("clear", [], 1, `Cleared ${todos.length} todos`);
      }

      case "list":
      default:
        return serialize("list", todos, nextId, formatTodos(todos));
    }
  },
};
