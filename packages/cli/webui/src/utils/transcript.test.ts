import { describe, expect, it } from "vitest";

import { splitServedPrompt } from "./transcript.js";

describe("a stored user message", () => {
  it("separates the harness notes from the words the user typed", () => {
    expect(
      splitServedPrompt(
        "<system-reminder>\nrepo uses pnpm\n</system-reminder>\n\nfix the login bug",
      ),
    ).toEqual({ userText: "fix the login bug", notes: ["repo uses pnpm"] });
  });

  it("leaves a plain message alone", () => {
    expect(splitServedPrompt("hello")).toEqual({
      userText: "hello",
      notes: [],
    });
  });

  it("shows the block rather than an empty bubble when nothing was typed", () => {
    const only = "<system-reminder>\na note\n</system-reminder>";

    expect(splitServedPrompt(only).userText).toBe(only);
  });

  it("peels a hook's JSON envelope out of a stored note", () => {
    const envelope = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "repo uses pnpm",
      },
    });

    expect(
      splitServedPrompt(
        `<system-reminder>\n${envelope}\n</system-reminder>\n\nfix the login bug`,
      ),
    ).toEqual({ userText: "fix the login bug", notes: ["repo uses pnpm"] });
  });

  it("keeps a JSON note that carries no context field as-is", () => {
    expect(
      splitServedPrompt('<system-reminder>\n{"answer": 42}\n</system-reminder>\n\nhi'),
    ).toEqual({ userText: "hi", notes: ['{"answer": 42}'] });
  });
});
