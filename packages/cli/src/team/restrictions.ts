/**
 * How a delegated agent may be narrower than the session that started it.
 *
 * A verifier has to run the build and the tests, so the only restriction that
 * makes sense for one is "no file writes" - dropping `Bash` as well would leave
 * it reading code and reporting a guess, which is the failure mode the whole
 * role exists to avoid.
 *
 * The type lives in its own module so team rosters can declare the same values
 * without importing the subagent runtime, which imports rosters back: the
 * dependency direction between the two groups stays one-way.
 */
export type SubagentRestriction = "readonly" | "no-writes";
