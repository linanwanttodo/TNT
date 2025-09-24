/**
 * A prompt profile is the second axis: the permission mode decides what the
 * tools may touch, and the profile decides what the agent is being asked to do.
 * A debugging turn still needs write permission, so folding the two together
 * would be wrong. Only `plan` has a permission-shaped twin, and it reuses the
 * mode's own text rather than a second wording of the same rule.
 *
 * Every text here is static: the profile lands in the cached prefix, so a value
 * that changed between turns would cost more than it saves.
 */
export const PROMPT_PROFILES = ["default", "plan", "debug", "review"] as const;

export type PromptProfile = (typeof PROMPT_PROFILES)[number];

export function isPromptProfile(value: string): value is PromptProfile {
  return (PROMPT_PROFILES as readonly string[]).includes(value);
}

/**
 * The plan text lives here and is used by the permission mode and the profile
 * alike, so switching to plan one way and the other produce the same bytes.
 */
export const PLAN_MODE_TEXT =
  '\n<context name="planMode">You are operating in _Plan Mode_, which means that your goal is to help the user investigate their ideas and produce a plan before taking action. You may write documentation files (.md, .mdx, .markdown, .rst, .txt) and read everything, but you must not change code or any other file: a write outside documentation is refused, and the Bash tool only runs commands that cannot modify the project. Ask the user to switch to agent mode if they want changes made. Produce planning artifacts only: an implementation plan, the decisions behind it, and a todo list the user can follow, written to documentation files. Keep the plan concrete, ordered, and tied to specific files.</context>\n';

const DEBUG_TEXT =
  '\n<context name="profile">You are in a debugging turn. Find the cause before proposing a fix: reproduce the failure, read the code the failure runs through, and say what mechanism produces it. A change that makes the symptom disappear without explaining it is not a fix here. Keep the reproduction command in your answer so the user can run it too.</context>\n';

const REVIEW_TEXT =
  '\n<context name="profile">You are in a review. Findings come first, ordered by severity, each with the file and line it lives at and what goes wrong. Open questions and assumptions come after the findings. The change summary is secondary context, and it is fine to leave it out. If nothing is wrong, say that plainly and name the test gaps or residual risk you can see.</context>\n';

/** Static text for the profile, empty for the default so nothing changes there. */
export function profileSection(profile: PromptProfile): string {
  switch (profile) {
    case "plan":
      return PLAN_MODE_TEXT;
    case "debug":
      return DEBUG_TEXT;
    case "review":
      return REVIEW_TEXT;
    default:
      return "";
  }
}
