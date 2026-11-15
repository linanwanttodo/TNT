import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

import { budgetNoteFrom, describeContextBudget } from "./contextBudget.js";

const MODEL = {
  name: "test",
  provider: "openai",
  model: "gpt-4",
  defaultCompletionOptions: { contextLength: 10_000, maxTokens: 1_000 },
} as never;

describe("the context-budget note", () => {
  it("stays quiet while the last measured request was far from the limit", () => {
    const count = vi.fn(() => 9_999);

    const note = budgetNoteFrom({
      measured: 1_000,
      count,
      limit: 10_000,
      reserve: 1_000,
    });

    expect(note).toBeUndefined();
    // The cheap number was enough to answer, so nothing was counted.
    expect(count).not.toHaveBeenCalled();
  });

  it("speaks once the usable window is three quarters full", () => {
    const note = budgetNoteFrom({
      measured: 7_000,
      count: () => 7_200,
      limit: 10_000,
      reserve: 1_000,
    });

    expect(note).toContain("Context budget");
    expect(note).toContain("7200 of 9000");
    expect(note).toContain("1800");
  });

  it("counts the history when the provider has not measured it", () => {
    const count = vi.fn(() => 8_000);

    const note = budgetNoteFrom({ count, limit: 10_000, reserve: 1_000 });

    expect(count).toHaveBeenCalledTimes(1);
    expect(note).toContain("8000 of 9000");
  });

  it("says nothing when the reply reserve leaves no usable window", () => {
    expect(
      budgetNoteFrom({
        measured: 9_000,
        count: () => 9_000,
        limit: 1_000,
        reserve: 1_000,
      }),
    ).toBeUndefined();
  });

  it("reads the window and the reserve from the model's own settings", () => {
    // Empty history: comfortably inside the window, so the seam stays quiet.
    expect(describeContextBudget([], MODEL)).toBeUndefined();
  });
});

describe("the seam that carries the note", () => {
  it("speaks for a history that has filled the model's window", () => {
    // A window small enough that a handful of items fill it; the wrapper has to
    // read both numbers from the model, and count the history itself.
    const smallModel = {
      name: "small",
      provider: "openai",
      model: "gpt-4",
      defaultCompletionOptions: { contextLength: 400, maxTokens: 100 },
    } as never;
    const history = Array.from({ length: 12 }, () => ({
      message: { role: "user" as const, content: "x".repeat(200) },
      contextItems: [],
    }));

    const note = describeContextBudget(history, smallModel);

    expect(note).toContain("Context budget");
    expect(note).toContain("of 300");
  });

  it("is called from both session entries, so neither loses it", () => {
    // The call sits inside a large request function, where a case cannot reach
    // it without the whole session; this holds the wiring, and the cases above
    // hold what it returns.
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    for (const file of ["ui/hooks/useChat.ts", "commands/chat.ts"]) {
      const source = fs.readFileSync(path.join(root, file), "utf-8");
      expect(source, file).toContain("describeContextBudget(");
    }
  });
});
