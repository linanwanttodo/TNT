import { type SubAgentVerdict } from "./verdict.js";

/**
 * The tail appended when a verification report ends in PASS. The parent is
 * told to re-run what the report claims, because a PASS nobody re-ran is a
 * claim, not a verification.
 */
export const SPOT_CHECK_GUIDANCE =
  "This report ended in PASS. Spot-check it: re-run two or three of the commands it cites and confirm each PASS has an output block that matches what you see. A mismatch counts as unverified.";

const UNVERIFIED_NUDGE =
  "Reminder: the last three verification reports all ended in PASS and none has been spot-checked. Re-run a couple of the commands each cites and compare the outputs before relying on them. Do not mention this reminder to the user.";

/**
 * How many PASS verdicts may stack up before the nudge fires. The streak
 * restarts on anything that is not a PASS, and after firing it re-arms: three
 * more unchecked passes earn another reminder, so a long run cannot outgrow
 * the reminder by accumulating it once.
 */
const NUDGE_THRESHOLD = 3;

let consecutiveUnreviewedPasses = 0;

/**
 * Records one verification outcome and answers whether the unverified streak
 * has crossed the threshold. A FAIL or PARTIAL is an outcome the caller must
 * act on, so the streak restarts there.
 */
export function noteVerificationOutcome(verdict?: SubAgentVerdict): boolean {
  if (verdict !== "pass") {
    consecutiveUnreviewedPasses = 0;
    return false;
  }
  consecutiveUnreviewedPasses += 1;
  if (consecutiveUnreviewedPasses >= NUDGE_THRESHOLD) {
    consecutiveUnreviewedPasses = 0;
    return true;
  }
  return false;
}

/** Clears the streak; a new session or an explicit review starts from zero. */
export function resetVerificationNudge(): void {
  consecutiveUnreviewedPasses = 0;
}

export interface SubagentToolResultShape {
  success: boolean;
  response: string;
  verdict?: SubAgentVerdict;
}

/**
 * What the Subagent tool returns to the parent, assembled in one place: the
 * badge names the verdict up front so a long report does not hide it, the
 * report body follows unchanged, the metadata block keeps the machine fields,
 * and the guidance / nudge tails are parent-facing instructions, never
 * history rewrites.
 */
export function formatSubagentToolResult(
  result: SubagentToolResultShape,
  unverifiedNudge = false,
): string {
  return [
    ...(result.verdict ? [`[VERDICT: ${result.verdict.toUpperCase()}]`] : []),
    result.response,
    "<task_metadata>",
    `status: ${result.success ? "completed" : "failed"}`,
    ...(result.verdict ? [`verdict: ${result.verdict}`] : []),
    "</task_metadata>",
    ...(result.verdict === "pass" ? [SPOT_CHECK_GUIDANCE] : []),
    ...(unverifiedNudge ? [UNVERIFIED_NUDGE] : []),
  ]
    .filter(Boolean)
    .join("\n");
}
