import { describe, expect, it } from "vitest";

import { composeServedPrompt, splitServedPrompt } from "./promptNotes.js";

describe("the prompt a turn is served with", () => {
  it("peels a raw hook JSON envelope instead of serving the braces", () => {
    const note = JSON.stringify({ additionalContext: "Use skills first." });
    const served = composeServedPrompt("hi", [note]);
    expect(served).toContain("Use skills first.");
    expect(served).not.toContain("additionalContext");
  });

  it("marks each harness note and leaves the user's words last", () => {
    const served = composeServedPrompt("fix the file", [
      "style: two spaces",
      "repo uses pnpm",
    ]);

    expect(served).toBe(
      "<system-reminder>\nstyle: two spaces\n</system-reminder>\n\n" +
        "<system-reminder>\nrepo uses pnpm\n</system-reminder>\n\n" +
        "fix the file",
    );
  });

  it("serves the message alone when there is nothing to add", () => {
    expect(composeServedPrompt("hi", ["", "   "])).toBe("hi");
  });

  it("does not wrap a note that already carries its own marker", () => {
    const marked =
      "<system-reminder>\nFiles changed on disk.\n</system-reminder>";

    expect(composeServedPrompt("go", [marked])).toBe(`${marked}\n\ngo`);
  });

  it("gives back the user's words and the notes in order", () => {
    const served = composeServedPrompt("fix the file", [
      "repo uses pnpm",
      "style: two spaces",
    ]);

    expect(splitServedPrompt(served)).toEqual({
      userText: "fix the file",
      notes: ["repo uses pnpm", "style: two spaces"],
    });
  });

  it("leaves a message nobody added anything to untouched", () => {
    expect(splitServedPrompt("just a question")).toEqual({
      userText: "just a question",
      notes: [],
    });
  });

  it("peels a hook's JSON envelope out of a stored note", () => {
    const envelope = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "repo uses pnpm",
      },
    });
    const served = composeServedPrompt("hi", [envelope]);

    expect(splitServedPrompt(served)).toEqual({
      userText: "hi",
      notes: ["repo uses pnpm"],
    });
  });

  it("peels a bare additionalContext envelope out of a stored note", () => {
    const served = composeServedPrompt("hi", [
      JSON.stringify({ additionalContext: "style: two spaces" }),
    ]);

    expect(splitServedPrompt(served)).toEqual({
      userText: "hi",
      notes: ["style: two spaces"],
    });
  });

  it("keeps a JSON note that carries no context field as-is", () => {
    const served = composeServedPrompt("hi", ['{"answer": 42}']);

    expect(splitServedPrompt(served)).toEqual({
      userText: "hi",
      notes: ['{"answer": 42}'],
    });
  });
});
