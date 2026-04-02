import { describe, expect, it } from "vitest";

import {
  exitCodeForTermination,
  type TerminationReason,
} from "./termination.js";

/**
 * The process status is the only signal a CI job or editor extension reads
 * without parsing output, so every truncation has to be a failure there and
 * every deliberate ending a success. Kept as a table because the mapping is
 * the contract, not the implementation.
 */
describe("exitCodeForTermination", () => {
  const cases: Array<[TerminationReason | undefined, 0 | 1]> = [
    [undefined, 0],
    ["no_tool_calls", 0],
    ["user_abort", 0],
    ["hook_stop", 0],
    ["tool_stop", 0],
    ["max_steps", 1],
    ["loop_detected", 1],
    ["compaction_circuit_open", 1],
    ["stream_stall", 1],
    ["context_unrecoverable", 1],
    ["request_timeout", 1],
  ];

  it.each(cases)("maps %s to %i", (reason, expected) => {
    expect(exitCodeForTermination(reason)).toBe(expected);
  });

  it("keeps every truncation a failure and every ending a success", () => {
    const truncations: TerminationReason[] = [
      "max_steps",
      "loop_detected",
      "compaction_circuit_open",
      "stream_stall",
      "context_unrecoverable",
      "request_timeout",
    ];
    expect(truncations.map(exitCodeForTermination)).toEqual(
      truncations.map(() => 1),
    );
  });
});
