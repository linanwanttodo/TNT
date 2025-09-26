import type { Todo } from "../tools/todo.js";

import {
  buildTodoReminder,
  TODO_REMINDER_THRESHOLD,
  TodoReminderTracker,
} from "./todoReminder.js";

const todos: Todo[] = [
  { id: 1, text: "first", done: true },
  { id: 2, text: "second", done: false },
];

function recordCalls(
  tracker: TodoReminderTracker,
  count: number,
  tool: string,
) {
  let reminder: string | undefined;
  for (let i = 0; i < count; i++) {
    reminder = tracker.recordToolResult(tool, todos);
  }
  return reminder;
}

describe("TodoReminderTracker", () => {
  it("stays quiet until the threshold is reached, never one call early", () => {
    const tracker = new TodoReminderTracker();
    expect(
      recordCalls(tracker, TODO_REMINDER_THRESHOLD - 1, "Read"),
    ).toBeUndefined();
  });

  it("reminds on the threshold call", () => {
    const tracker = new TodoReminderTracker();
    expect(recordCalls(tracker, TODO_REMINDER_THRESHOLD, "Read")).toContain(
      `${TODO_REMINDER_THRESHOLD} tool calls have passed`,
    );
  });

  it("counts again after reminding instead of reminding every call", () => {
    const tracker = new TodoReminderTracker();
    recordCalls(tracker, TODO_REMINDER_THRESHOLD, "Read");

    expect(
      recordCalls(tracker, TODO_REMINDER_THRESHOLD - 1, "Read"),
    ).toBeUndefined();
    expect(recordCalls(tracker, 1, "Read")).toBeDefined();
  });

  it("a Todo call resets the count", () => {
    const tracker = new TodoReminderTracker();
    recordCalls(tracker, TODO_REMINDER_THRESHOLD - 1, "Bash");

    expect(tracker.recordToolResult("Todo", todos)).toBeUndefined();
    expect(
      recordCalls(tracker, TODO_REMINDER_THRESHOLD - 1, "Bash"),
    ).toBeUndefined();
    expect(recordCalls(tracker, 1, "Bash")).toBeDefined();
  });

  it("never reminds while there is no list to keep truthful", () => {
    const tracker = new TodoReminderTracker();
    for (let i = 0; i < TODO_REMINDER_THRESHOLD * 3; i++) {
      expect(tracker.recordToolResult("Read", [])).toBeUndefined();
    }
  });
});

describe("buildTodoReminder", () => {
  it("names the count, the progress and every item", () => {
    const text = buildTodoReminder(todos, TODO_REMINDER_THRESHOLD);

    expect(text).toContain(`${TODO_REMINDER_THRESHOLD} tool calls have passed`);
    expect(text).toContain("1 of 2 done");
    expect(text).toContain("[x] #1: first");
    expect(text).toContain("[ ] #2: second");
  });
});
