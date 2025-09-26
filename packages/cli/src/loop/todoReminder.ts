import type { Todo } from "../tools/todo.js";

/**
 * How many completed tool calls without a Todo update it takes before the
 * model is reminded. Ten of ten means ten: a shorter leash nags during the
 * ordinary stretch of reads and edits between two updates, and a reminder
 * that arrives too often is one the model learns to ignore.
 */
export const TODO_REMINDER_THRESHOLD = 10;

export function buildTodoReminder(todos: Todo[], threshold: number): string {
  const done = todos.filter((todo) => todo.done).length;
  const list = todos
    .map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`)
    .join("\n");
  return `${threshold} tool calls have passed without a todo update. Keep the list below truthful as you work: mark an item completed only when its result is verified, add work you have discovered, and keep at most one item in progress.\n\nCurrent todo list (${done} of ${todos.length} done):\n${list}`;
}

/**
 * Per-turn state for the todo reminder. It rides inside a tool result - the
 * tail of the request, after the cached prefix - so a nagging line never
 * invalidates the prefix the way a system message change would.
 */
export class TodoReminderTracker {
  private callsSinceUpdate = 0;

  /**
   * Records one completed tool result and returns the reminder to append to
   * it, if this is the call that crosses the threshold. Returns undefined
   * while there is no list to keep truthful: reminding a model with nothing
   * to update would be the early nag the threshold exists to prevent.
   */
  recordToolResult(toolName: string, todos: Todo[]): string | undefined {
    if (toolName === "Todo") {
      this.callsSinceUpdate = 0;
      return undefined;
    }
    this.callsSinceUpdate += 1;
    if (this.callsSinceUpdate < TODO_REMINDER_THRESHOLD) {
      return undefined;
    }
    if (todos.length === 0) {
      return undefined;
    }
    this.callsSinceUpdate = 0;
    return buildTodoReminder(todos, TODO_REMINDER_THRESHOLD);
  }
}
