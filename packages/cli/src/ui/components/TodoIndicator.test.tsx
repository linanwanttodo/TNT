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
  it("keeps finished rows with a checkmark, shows five open rows, and summarizes the rest", () => {
    const frame = frameWith(
      todosOf(
        { text: "task 1" },
        { text: "task 2" },
        { text: "task 3" },
        { text: "task 4" },
        { text: "task 5" },
        { text: "task 6" },
        { text: "task 7" },
        { text: "finished one", done: true },
        { text: "finished two", done: true },
      ),
    );

    expect(frame).toContain("TODO");
    expect(frame).toContain("· 2/9");
    expect(frame).toContain("☑ finished one");
    expect(frame).toContain("☑ finished two");
    expect(frame).toContain("├─ ☐ task 1");
    expect(frame).toContain("☐ task 5");
    expect(frame).not.toContain("task 6");
    expect(frame).toContain("└─ … 2 more");
  });

  it("folds to the header counter and back", async () => {
    const { toggleTodoExpanded } = await import("../todoFold.js");
    toggleTodoExpanded();
    try {
      const folded = frameWith(todosOf({ text: "task 1" }));
      expect(folded).toContain("· 0/1");
      expect(folded).toContain("▸");
      expect(folded).not.toContain("task 1");
    } finally {
      toggleTodoExpanded();
    }
    const expanded = frameWith(todosOf({ text: "task 1" }));
    expect(expanded).toContain("▾");
    expect(expanded).toContain("☐ task 1");
  });

  it("shows every open row and closes the spine when five or fewer remain", () => {
    const frame = frameWith(
      todosOf(
        { text: "done one", done: true },
        { text: "done two", done: true },
        { text: "done three", done: true },
        { text: "done four", done: true },
        { text: "done five", done: true },
        { text: "done six", done: true },
        { text: "task 1" },
        { text: "task 2" },
        { text: "task 3" },
        { text: "task 4" },
        { text: "task 5" },
      ),
    );

    expect(frame).toContain("· 6/11");
    expect(frame).toContain("├─ ☐ task 1");
    expect(frame).toContain("└─ ☐ task 5");
    expect(frame).not.toContain("…");
  });

  it("takes no space once every todo is done", () => {
    expect(frameWith(todosOf({ text: "finished", done: true }))).toBe("");
  });
});
