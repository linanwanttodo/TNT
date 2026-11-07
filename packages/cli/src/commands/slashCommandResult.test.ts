import { describe, expect, it } from "vitest";

import { classifySlashResult } from "./slashCommandResult.js";

describe("classifying a slash result for a surface without pickers", () => {
  it("sends the text a prompt source hands over", () => {
    expect(
      classifySlashResult({ newInput: "Load the skill named review" }),
    ).toEqual({ kind: "prompt", prompt: "Load the skill named review" });
  });

  it("prints what a listing command answered", () => {
    expect(
      classifySlashResult({ output: "Available subagents:\n- dev" }),
    ).toEqual({ kind: "print", output: "Available subagents:\n- dev" });
  });

  it("treats a remote diff the same as any other printed output", () => {
    expect(classifySlashResult({ diffContent: "diff --git a b" })).toEqual({
      kind: "print",
      output: "diff --git a b",
    });
  });

  it("resolves the lifecycle results before the text ones", () => {
    expect(classifySlashResult({ exit: true, output: "bye" })).toEqual({
      kind: "exit",
    });
    expect(classifySlashResult({ clear: true, output: "cleared" })).toEqual({
      kind: "clear",
    });
    expect(
      classifySlashResult({ compact: true, output: "compacting" }),
    ).toEqual({ kind: "compact" });
  });

  it("prefers a prompt over printed output when a result carries both", () => {
    expect(
      classifySlashResult({ newInput: "forwarded text", output: "shown text" }),
    ).toEqual({ kind: "prompt", prompt: "forwarded text" });
  });

  it("reports a picker command instead of silently dropping it", () => {
    // What /model, /sessions and /mcp answer: the flag alone, no text.
    expect(classifySlashResult({ openModelSelector: true })).toEqual({
      kind: "unsupported",
    });
    expect(classifySlashResult({})).toEqual({ kind: "unsupported" });
    // An empty output is not something to print either.
    expect(classifySlashResult({ output: "" })).toEqual({
      kind: "unsupported",
    });
  });
});
