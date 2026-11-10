import { render } from "ink-testing-library";
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { promptMarker, UserInput } from "./UserInput.js";

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
  await services.toolPermissions.doInitialize({ mode: "auto" });
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
      const border = lines.findIndex((line) => line.includes("[Auto]"));
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

  it("uses only horizontal rules around the input", async () => {
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
      const rule = lines.findIndex((line) => line.includes("[Auto]"));

      expect(rule).toBeGreaterThan(-1);
      expect(lines[rule].startsWith("─[Auto]")).toBe(true);
      expect(lines[rule].endsWith("─")).toBe(true);

      const inputLine = lines.findIndex(
        (line) => line.includes("Ask anything") || line.includes("输入内容"),
      );
      expect(inputLine).toBe(rule + 1);
      expect(lines[inputLine]).not.toContain("│");

      expect(lines[inputLine + 1].replace(/─/g, "").trim()).toBe("");
      expect(lines.some((line) => line.includes("│"))).toBe(false);
    } finally {
      tree.unmount();
    }
  });

  it("marks the prompt with the Claude pointer", async () => {
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
      const frame = tree.lastFrame() ?? "";

      expect(frame).toContain("❯ ");
      expect(frame).not.toContain("> ");
    } finally {
      tree.unmount();
    }
  });
});

describe("promptMarker", () => {
  it("uses the subtle Claude pointer at rest", () => {
    expect(promptMarker({ bash: false, remote: false, busy: false })).toEqual({
      glyph: "❯ ",
      tone: "subtle",
      dim: false,
    });
  });

  it("dims the pointer while a turn runs", () => {
    expect(promptMarker({ bash: false, remote: false, busy: true }).dim).toBe(
      true,
    );
  });

  it("keeps the shell and remote marks", () => {
    expect(promptMarker({ bash: true, remote: false, busy: false }).glyph).toBe(
      "$ ",
    );
    expect(promptMarker({ bash: false, remote: true, busy: false }).glyph).toBe(
      "◉ ",
    );
  });
});
