import type { HookEventName } from "./types.js";

/**
 * What a hook is allowed to contribute, independent of which event fires it.
 *
 * A plugin, a skill, or a hook used to be three ways to add the same three
 * things - prompt text, tool declarations, and a guard. This table names the
 * facet each event belongs to, so a new entry point must say which facet it
 * extends instead of adding a fourth mechanism.
 */
export type HookFacet =
  "prompt" | "tool" | "guard" | "session" | "notification";

export const HOOK_EVENT_FACETS: Record<HookEventName, readonly HookFacet[]> = {
  PreToolUse: ["tool", "guard"],
  PostToolUse: ["tool"],
  PostToolUseFailure: ["tool"],
  PermissionRequest: ["tool", "guard"],
  UserPromptSubmit: ["prompt"],
  SessionStart: ["session", "prompt"],
  SessionEnd: ["session"],
  Stop: ["session"],
  Notification: ["notification"],
  SubagentStart: ["session"],
  SubagentStop: ["session"],
  PreCompact: ["prompt", "session"],
  ConfigChange: ["session"],
  WorktreeCreate: ["session"],
  WorktreeRemove: ["session"],
};

export function facetsForHookEvent(event: HookEventName): readonly HookFacet[] {
  return HOOK_EVENT_FACETS[event];
}
