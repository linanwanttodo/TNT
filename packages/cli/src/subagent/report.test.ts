import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SPOT_CHECK_GUIDANCE,
  formatSubagentToolResult,
  noteVerificationOutcome,
  resetVerificationNudge,
} from "./report.js";

const PASS_REPORT = [
  "### Check: build",
  "**Command run:** npm run build",
  "**Output observed:** ok",
  "**Result:** PASS",
  "",
  "VERDICT: PASS",
].join("\n");

describe("formatSubagentToolResult", () => {
  it("names the verdict in a badge and carries the machine metadata (T3.1)", () => {
    const output = formatSubagentToolResult({
      success: true,
      response: PASS_REPORT,
      verdict: "pass",
    });

    expect(output.startsWith("[VERDICT: PASS]\n")).toBe(true);
    expect(output).toContain(PASS_REPORT);
    expect(output).toContain("<task_metadata>");
    expect(output).toContain("verdict: pass");
  });

  it("appends the spot-check guidance to a PASS report (T3.3)", () => {
    const output = formatSubagentToolResult({
      success: true,
      response: PASS_REPORT,
      verdict: "pass",
    });

    expect(output).toContain(SPOT_CHECK_GUIDANCE);
  });

  it("leaves a FAIL or unverified report without the PASS guidance", () => {
    const failed = formatSubagentToolResult({
      success: true,
      response: "report\nVERDICT: FAIL",
      verdict: "fail",
    });
    const unverified = formatSubagentToolResult({
      success: true,
      response: "a plain explore answer",
    });

    expect(failed).not.toContain(SPOT_CHECK_GUIDANCE);
    expect(failed).toContain("[VERDICT: FAIL]");
    expect(unverified).not.toContain(SPOT_CHECK_GUIDANCE);
    expect(unverified).not.toContain("[VERDICT:");
  });

  it("appends the unverified reminder only when the tracker fires (T3.4)", () => {
    const nudged = formatSubagentToolResult(
      { success: true, response: PASS_REPORT, verdict: "pass" },
      true,
    );
    const quiet = formatSubagentToolResult(
      { success: true, response: PASS_REPORT, verdict: "pass" },
      false,
    );

    expect(nudged).toContain("Reminder: the last three verification reports");
    expect(quiet).not.toContain("Reminder:");
  });
});

describe("noteVerificationOutcome", () => {
  beforeEach(() => {
    resetVerificationNudge();
  });

  afterEach(() => {
    resetVerificationNudge();
  });

  it("fires once at three consecutive passes and re-arms (T3.4)", () => {
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(true);
    // The reminder fired once; the next pass starts a fresh streak.
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(true);
  });

  it("restarts the streak on a FAIL or PARTIAL", () => {
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("fail")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    // Only the third pass after the reset crosses the threshold.
    expect(noteVerificationOutcome("pass")).toBe(true);
    expect(noteVerificationOutcome("partial")).toBe(false);
  });

  it("treats a missing verdict as a non-pass", () => {
    expect(noteVerificationOutcome(undefined)).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome(undefined)).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(false);
    expect(noteVerificationOutcome("pass")).toBe(true);
  });
});
