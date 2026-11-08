import { describe, expect, it } from "vitest";

import { composeSubagentBrief, isStructuredSubagentPrompt } from "./brief.js";

const TERSE = "fix the parser bug in src/parser.ts";

describe("composeSubagentBrief", () => {
  it("expands a terse prompt and keeps the objective verbatim", () => {
    const brief = composeSubagentBrief({
      memberName: "implementer",
      description: "writes code",
      prompt: TERSE,
    });

    expect(brief.composed).toBe(true);
    expect(brief.prompt).toContain("Role: implementer - writes code");
    expect(brief.prompt).toContain("Objective (verbatim from the caller):");
    expect(brief.prompt).toContain(TERSE);
  });

  it("leaves a prompt with sections byte for byte unchanged", () => {
    const structured = [
      "Objective: fix the parser bug.",
      "",
      "Scope:",
      "- src/parser.ts",
      "",
      "Constraints:",
      "- Do not change the public API.",
      "",
      "Report: what changed and the test output.",
    ].join("\n");

    const brief = composeSubagentBrief({
      memberName: "implementer",
      prompt: structured,
    });

    expect(brief.composed).toBe(false);
    expect(brief.prompt).toBe(structured);
  });

  it("leaves a long unstructured prompt unchanged", () => {
    const long = `${TERSE}. ${"Explain the call path before changing it. ".repeat(20)}`;
    expect(long.length).toBeGreaterThanOrEqual(480);

    const brief = composeSubagentBrief({
      memberName: "implementer",
      prompt: long,
    });

    expect(brief.composed).toBe(false);
    expect(brief.prompt).toBe(long);
  });

  it("reflects a read-only restriction", () => {
    const brief = composeSubagentBrief({
      memberName: "explore",
      prompt: "map the parser call path",
      restriction: "readonly",
    });

    expect(brief.prompt).toContain("Read-only:");
    expect(brief.prompt).toContain("cannot run commands");
  });

  it("reflects a no-writes restriction", () => {
    const brief = composeSubagentBrief({
      memberName: "verification",
      prompt: "run the parser tests",
      restriction: "no-writes",
    });

    expect(brief.prompt).toContain("No file writes:");
    expect(brief.prompt).toContain("running commands are allowed");
  });

  it("names every denied tool", () => {
    const brief = composeSubagentBrief({
      memberName: "verification",
      prompt: "run the parser tests",
      deniedTools: ["AskQuestion", "Exit"],
    });

    expect(brief.prompt).toContain("Unavailable tools: AskQuestion, Exit.");
  });

  it("lists the files the caller declared", () => {
    const brief = composeSubagentBrief({
      memberName: "implementer",
      prompt: TERSE,
      files: ["src/parser.ts", "src/parser.test.ts"],
    });

    expect(brief.prompt).toContain(
      "Scope (files): src/parser.ts, src/parser.test.ts",
    );
  });

  it("says so when no file scope was declared", () => {
    const brief = composeSubagentBrief({
      memberName: "implementer",
      prompt: TERSE,
    });

    expect(brief.prompt).toContain("Scope (files): none declared.");
  });

  it("carries the expected report shape", () => {
    const brief = composeSubagentBrief({
      memberName: "implementer",
      prompt: TERSE,
    });

    expect(brief.prompt).toContain("Report:");
    expect(brief.prompt).toContain(
      "progress, waiting, ready, blocked, failed, or dropped",
    );
    expect(brief.prompt).toContain("VERDICT: PASS | FAIL | PARTIAL");
    expect(brief.prompt).toContain("commands you ran with their output");
  });

  it("uses an explicit goal as the objective and keeps the raw prompt", () => {
    const brief = composeSubagentBrief({
      memberName: "implementer",
      prompt: "do the thing",
      goal: "Make the parser reject empty input.",
    });

    expect(brief.prompt).toContain(
      "Objective (verbatim from the caller):\nMake the parser reject empty input.",
    );
    expect(brief.prompt).toContain("Caller's prompt (verbatim):\ndo the thing");
  });

  it("keeps an empty prompt unchanged when there is no goal", () => {
    const brief = composeSubagentBrief({
      memberName: "implementer",
      prompt: "",
    });

    expect(brief.composed).toBe(false);
    expect(brief.prompt).toBe("");
  });
});

describe("isStructuredSubagentPrompt", () => {
  it("recognizes markdown headings and labeled sections", () => {
    expect(isStructuredSubagentPrompt("## Task\nfix it")).toBe(true);
    expect(isStructuredSubagentPrompt("Goal:\nfix it")).toBe(true);
  });

  it("recognizes a prompt with several lines and enough words", () => {
    const body = [
      "Read the parser first and note where empty input is handled.",
      "Then add the guard and run the parser tests.",
      "Finally report the command output and anything still unresolved.",
      "Do not change the public API or the error message wording.",
    ].join("\n");

    expect(isStructuredSubagentPrompt(body)).toBe(true);
  });

  it("does not mistake a terse instruction for a brief", () => {
    expect(isStructuredSubagentPrompt(TERSE)).toBe(false);
    expect(isStructuredSubagentPrompt("do it")).toBe(false);
  });
});
