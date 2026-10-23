import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "../../i18n/index.js";
import { readTodoState, type Todo } from "../../tools/todo.js";

import { TodoIndicator } from "./TodoIndicator.js";

vi.mock("../../tools/todo.js", () => ({
  readTodoState: vi.fn(),
}));

const mockedRead = vi.mocked(readTodoState);

function todosOf(...entries: Array<Partial<Todo> & { text: string }>): Todo[] {
  return entries.map((entry, index) => ({
    id: index + 1,
    done: false,
    ...entry,
  }));
}

function frameWith(todos: Todo[]): string {
  mockedRead.mockReturnValue({ todos, nextId: todos.length + 1 });
  const tree = render(<TodoIndicator />);
  const frame = tree.lastFrame() ?? "";
  tree.unmount();
  return frame;
}

afterEach(() => {
  mockedRead.mockReset();
  setLocale("en");
});

describe("TodoIndicator", () => {
  it("shows at most five unfinished rows and counts the rest on the header", () => {
    const frame = frameWith(
      todosOf(
        { text: "done one", done: true },
        { text: "task 1" },
        { text: "task 2" },
        { text: "task 3" },
        { text: "task 4" },
        { text: "task 5" },
        { text: "task 6" },
        { text: "task 7" },
        { text: "task 8" },
        { text: "done two", done: true },
      ),
    );

    expect(frame).toContain("Todos 2/10 · +3");
    for (const visible of ["task 1", "task 5"]) {
      expect(frame).toContain(visible);
    }
    expect(frame).not.toContain("task 6");
    expect(frame).not.toContain("task 8");
    expect(frame).not.toContain("done one");
    expect(frame).not.toContain("done two");
  });

  it("hides completed rows when fewer than five remain", () => {
    const frame = frameWith(
      todosOf({ text: "finished", done: true }, { text: "remaining" }),
    );

    expect(frame).toContain("Todos 1/2");
    expect(frame).toContain("remaining");
    expect(frame).not.toContain("finished");
    expect(frame).not.toContain("+");
  });

  it("takes no space once every todo is done", () => {
    expect(frameWith(todosOf({ text: "finished", done: true }))).toBe("");
  });
});
