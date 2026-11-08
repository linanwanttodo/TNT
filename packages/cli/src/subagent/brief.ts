import type { SubagentRestriction } from "../team/restrictions.js";

/**
 * A deterministic expansion of a terse dispatch into the shape a delegated
 * agent needs: who it is, what it was asked to do, what it may not do, and how
 * to report. Nothing here is extracted with a model call, and nothing is
 * invented: the objective is the caller's text verbatim, and every constraint
 * comes from the restriction and denied-tool list the dispatch already
 * resolved.
 *
 * A prompt that is already a brief is left alone. Re-wrapping a careful
 * caller's text in boilerplate adds tokens without adding a requirement.
 */
export interface SubagentBriefInput {
  readonly memberName: string;
  readonly description?: string;
  readonly prompt: string;
  readonly restriction?: SubagentRestriction;
  readonly deniedTools?: readonly string[];
  readonly files?: readonly string[];
  /**
   * An explicit objective from the caller. When present it is the verbatim
   * objective; the raw prompt is carried beside it so no caller text is lost.
   */
  readonly goal?: string;
}

export interface SubagentBrief {
  /** The prompt to send to the child, composed or unchanged. */
  readonly prompt: string;
  /** True when this module expanded a terse prompt; false when it was kept. */
  readonly composed: boolean;
}

/**
 * A prompt this long is a brief already, even without section labels: a
 * caller who wrote it invested more detail than the template would add.
 */
const STRUCTURED_MIN_CHARS = 480;
const STRUCTURED_MIN_LINES = 4;
const STRUCTURED_MIN_WORDS = 40;

/**
 * Section labels a caller may have written. The bracket only recognizes a
 * label at the start of a line, so prose like "the task: fix it" does not
 * count as structure.
 */
const SECTION_HEADING =
  /^[ \t]*(?:#{1,6}[ \t]+\S|(?:objective|goal|task|scope|files|context|background|constraints?|requirements?|acceptance|expected|deliverables?|plan|steps|report|verification|notes)[ \t]*:)/im;

function trimForLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Whether the caller already supplied a structured brief. Sections and length
 * are both signals; either one is enough to leave the text untouched.
 */
export function isStructuredSubagentPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed === "") return false;
  if (trimmed.length >= STRUCTURED_MIN_CHARS) return true;
  if (SECTION_HEADING.test(trimmed)) return true;

  const lines = trimmed.split(/\n+/).filter((line) => line.trim() !== "");
  if (lines.length < STRUCTURED_MIN_LINES) return false;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return words >= STRUCTURED_MIN_WORDS;
}

function objectiveOf(input: SubagentBriefInput): string {
  const goal = input.goal ?? "";
  return goal.trim() === "" ? input.prompt : goal;
}

function roleLine(input: SubagentBriefInput): string {
  const description = input.description ? trimForLine(input.description) : "";
  return description
    ? `Role: ${input.memberName} - ${description}`
    : `Role: ${input.memberName}`;
}

function scopeLines(files: readonly string[] | undefined): string[] {
  if (!files || files.length === 0) {
    return ["Scope (files): none declared."];
  }
  return [`Scope (files): ${files.join(", ")}`];
}

function constraintLines(input: SubagentBriefInput): string[] {
  const lines: string[] = [];
  if (input.restriction === "readonly") {
    lines.push(
      "- Read-only: you cannot create or modify files, and you cannot run commands.",
    );
  } else if (input.restriction === "no-writes") {
    lines.push(
      "- No file writes: you cannot create or modify files. Reading the workspace and running commands are allowed.",
    );
  }
  if (input.deniedTools && input.deniedTools.length > 0) {
    lines.push(`- Unavailable tools: ${input.deniedTools.join(", ")}.`);
  }
  return lines;
}

const REPORT_LINES = [
  "Report:",
  "- Close with one status word: progress, waiting, ready, blocked, failed, or dropped.",
  "- If the job is to verify work, finish with one line alone: VERDICT: PASS | FAIL | PARTIAL.",
  "- Include what you changed or found, the paths and line numbers that matter, the commands you ran with their output, and anything you could not verify.",
];

function renderBrief(input: SubagentBriefInput): string {
  const objective = objectiveOf(input);
  const lines: string[] = [
    roleLine(input),
    "",
    "Objective (verbatim from the caller):",
    objective,
    "",
    ...scopeLines(input.files),
  ];

  const constraints = constraintLines(input);
  if (constraints.length > 0) {
    lines.push("", "Constraints:", ...constraints);
  }

  if (objective !== input.prompt && input.prompt.trim() !== "") {
    lines.push("", "Caller's prompt (verbatim):", input.prompt);
  }

  lines.push("", ...REPORT_LINES);
  return lines.join("\n");
}

/**
 * Composes the prompt a delegated agent receives.
 *
 * The caller's objective is never paraphrased: a terse prompt becomes the
 * verbatim objective under a labeled heading, and a structured prompt passes
 * through byte for byte.
 */
export function composeSubagentBrief(input: SubagentBriefInput): SubagentBrief {
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const hasGoal = (input.goal ?? "").trim() !== "";

  if (prompt.trim() === "" && !hasGoal) {
    return { prompt, composed: false };
  }
  if (isStructuredSubagentPrompt(prompt)) {
    return { prompt, composed: false };
  }
  return { prompt: renderBrief(input), composed: true };
}
