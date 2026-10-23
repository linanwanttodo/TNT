import { render } from "ink-testing-library";
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { UserInput } from "./UserInput.js";

vi.mock("../session/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/index.js")>();
  return {
    ...actual,
    getSessionGoal: () => "ship the composer layout",
  };
});

vi.mock("../tools/todo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tools/todo.js")>();
  return {
    ...actual,
    readTodoState: () => ({
      todos: [{ id: 1, text: "finish the composer layout", done: false }],
      nextId: 2,
    }),
  };
});

const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  await services.toolPermissions.doInitialize({ mode: "default" });
});

describe("UserInput above-composer rows", () => {
  it("draws the goal and todo rows outside the input border", async () => {
    const tree = render(
      <UserInput
        onSubmit={vi.fn()}
        inputMode={true}
        isWaitingForResponse={false}
        assistant={{} as any}
      />,
    );

    try {
      await tick();
      const lines = (tree.lastFrame() ?? "").split("\n");
      const border = lines.findIndex((line) => line.includes("[Manual]"));
      const goal = lines.findIndex((line) =>
        line.includes("ship the composer layout"),
      );
      const todo = lines.findIndex((line) =>
        line.includes("finish the composer layout"),
      );

      expect(border).toBeGreaterThan(-1);
      expect(goal).toBeGreaterThan(-1);
      expect(todo).toBeGreaterThan(-1);
      expect(goal).toBeLessThan(border);
      expect(todo).toBeLessThan(border);
      expect(goal).toBeLessThan(todo);
    } finally {
      tree.unmount();
    }
  });
});
