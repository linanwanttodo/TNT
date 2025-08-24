import type { ChatHistoryItem } from "core/index.js";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getHistory = vi.fn<() => ChatHistoryItem[]>();

vi.mock("../services/index.js", () => ({
  services: {
    get chatHistory() {
      return { getHistory };
    },
  },
}));

import { buildTodoCarryContextItem, readTodoState, todoTool } from "./todo.js";

function assistantItem(results: { name: string; content: string }[]) {
  return {
    message: { role: "assistant", content: "" },
    contextItems: [],
    toolCallStates: results.map((result, index) => ({
      toolCallId: `call-${index}`,
      toolCall: {
        id: `call-${index}`,
        type: "function",
        function: { name: result.name, arguments: "{}" },
      },
      status: "done",
      parsedArgs: {},
      output: [
        {
          content: result.content,
          name: "Tool Result",
          description: "Tool execution result",
        },
      ],
    })),
  } as unknown as ChatHistoryItem;
}

async function run(args: Record<string, unknown>) {
  return todoTool.run(args);
}

describe("todo tool", () => {
  beforeEach(() => {
    getHistory.mockReset();
    getHistory.mockReturnValue([]);
  });

  test("adds todos and assigns increasing ids", async () => {
    const first = await run({ action: "add", text: "write tests" });
    expect(first).toContain("Added todo #1: write tests");

    getHistory.mockReturnValue([
      assistantItem([{ name: "Todo", content: first }]),
    ]);
    const second = await run({ action: "add", text: "ship it" });
    expect(second).toContain("Added todo #2: ship it");
  });

  test("toggles a todo and reports the new state", async () => {
    const added = await run({ action: "add", text: "write tests" });
    getHistory.mockReturnValue([
      assistantItem([{ name: "Todo", content: added }]),
    ]);

    const toggled = await run({ action: "toggle", id: 1 });
    expect(toggled).toContain("Todo #1 completed");

    getHistory.mockReturnValue([
      assistantItem([{ name: "Todo", content: toggled }]),
    ]);
    const toggledBack = await run({ action: "toggle", id: 1 });
    expect(toggledBack).toContain("Todo #1 uncompleted");
  });

  test("clears every todo", async () => {
    const added = await run({ action: "add", text: "write tests" });
    getHistory.mockReturnValue([
      assistantItem([{ name: "Todo", content: added }]),
    ]);

    const cleared = await run({ action: "clear" });
    expect(cleared).toContain("Cleared 1 todos");

    getHistory.mockReturnValue([
      assistantItem([{ name: "Todo", content: cleared }]),
    ]);
    expect(readTodoState().todos).toEqual([]);
  });

  test("reports errors for invalid input", async () => {
    expect(await run({ action: "add" })).toContain("text required for add");
    expect(await run({ action: "toggle" })).toContain("id required for toggle");

    const added = await run({ action: "add", text: "write tests" });
    getHistory.mockReturnValue([
      assistantItem([{ name: "Todo", content: added }]),
    ]);
    expect(await run({ action: "toggle", id: 99 })).toContain(
      "Todo #99 not found",
    );
  });

  test("keeps only the latest payload when history has several todo calls", () => {
    const first = {
      action: "add",
      todos: [{ id: 1, text: "first", done: false }],
      nextId: 2,
    };
    const second = {
      action: "add",
      todos: [
        { id: 1, text: "first", done: false },
        { id: 2, text: "second", done: true },
      ],
      nextId: 3,
    };

    getHistory.mockReturnValue([
      assistantItem([
        {
          name: "Todo",
          content: `Added todo #1: first\n\ntnt-todo:${JSON.stringify(first)}`,
        },
        {
          name: "Todo",
          content: `Added todo #2: second\n\ntnt-todo:${JSON.stringify(second)}`,
        },
      ]),
    ]);

    const state = readTodoState();
    expect(state.todos).toHaveLength(2);
    expect(state.nextId).toBe(3);
  });

  test("ignores payloads from other tools and malformed json", () => {
    getHistory.mockReturnValue([
      assistantItem([
        { name: "Todo", content: "Added todo #1: x\n\ntnt-todo:{not json" },
        {
          name: "Bash",
          content:
            'tnt-todo:{"action":"add","todos":[{"id":9,"text":"bad","done":false}],"nextId":10}',
        },
      ]),
    ]);

    expect(readTodoState().todos).toEqual([]);
  });

  test("replays a state that a compaction carried forward", () => {
    const carried = buildTodoCarryContextItem(
      [{ id: 1, text: "carried work", done: false }],
      2,
    )!;
    const history = [
      {
        message: { role: "assistant", content: "Summary of the conversation" },
        contextItems: [carried],
      },
    ] as unknown as ChatHistoryItem[];

    expect(readTodoState(history)).toEqual({
      todos: [{ id: 1, text: "carried work", done: false }],
      nextId: 2,
    });
  });

  test("lets a todo call after the carry override it", () => {
    const carried = buildTodoCarryContextItem(
      [{ id: 1, text: "carried work", done: false }],
      2,
    )!;
    const toggled = {
      action: "toggle",
      todos: [{ id: 1, text: "carried work", done: true }],
      nextId: 2,
    };
    const history = [
      {
        message: { role: "assistant", content: "Summary of the conversation" },
        contextItems: [carried],
      },
      assistantItem([
        {
          name: "Todo",
          content: `Todo #1 completed\n\ntnt-todo:${JSON.stringify(toggled)}`,
        },
      ]),
    ] as unknown as ChatHistoryItem[];

    expect(readTodoState(history).todos).toEqual([
      { id: 1, text: "carried work", done: true },
    ]);
  });
});
