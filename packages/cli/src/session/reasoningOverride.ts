import { useSyncExternalStore } from "react";

import { readSettingsString } from "../config/settingsFiles.js";

/**
 * The reasoning depth a `/think` command pinned for this session.
 *
 * Streaming reads it in `getDefaultCompletionOptions` so every request in the
 * turn inherits the override; the status bar reads it to show the live value
 * rather than the model's static default. It is a tiny external store because
 * the command handler (sibling of the composer) and the loop/status bar do not
 * share a prop tree.
 */
export type ReasoningDepth =
  "off" | "low" | "medium" | "high" | "xhigh" | "max" | "default";

/**
 * The depths a request can actually carry. "default" is TNT's word for "use
 * the model's own setting", so it is not a level offered by a picker.
 */
export const REASONING_DEPTH_VALUES = [
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const EFFORT_VALUES: ReasoningDepth[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * The zh labels `/think` prints back, so a reader can type what it showed.
 * Matched before the ASCII tokens, which stay the canonical form.
 */
const DEPTH_ALIASES: Record<string, ReasoningDepth> = {
  关闭: "off",
  默认: "default",
  低: "low",
  中: "medium",
  高: "high",
  极高: "xhigh",
  最高: "max",
};

let override: ReasoningDepth | null = null;
let restored = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pin the session's reasoning depth. `null` clears the override. */
export function setReasoningOverride(depth: ReasoningDepth | null): void {
  override = depth;
  emit();
}

export function getReasoningOverride(): ReasoningDepth | null {
  return override;
}

/** Parses a `/think` argument, or undefined when it is not a known depth. */
export function parseReasoningDepth(value: string): ReasoningDepth | undefined {
  const trimmed = value.trim();
  const alias = DEPTH_ALIASES[trimmed];
  if (alias) return alias;
  const normalized = trimmed.toLowerCase();
  if (normalized === "default") return "default";
  if (normalized === "off") return "off";
  if ((EFFORT_VALUES as string[]).includes(normalized)) {
    return normalized as ReasoningDepth;
  }
  return undefined;
}

export function useReasoningOverride(): ReasoningDepth | null {
  return useSyncExternalStore(
    subscribe,
    getReasoningOverride,
    getReasoningOverride,
  );
}

/**
 * Restores the persisted `/think` choice into the live store, once per
 * process. Runs lazily on the first request rather than at startup so every
 * mode (TUI, headless, standard chat) inherits the choice without each entry
 * point having to remember the call.
 */
export function restoreReasoningOverride(): void {
  if (restored) return;
  restored = true;
  const persisted = readSettingsString("reasoningEffort");
  const depth = persisted ? parseReasoningDepth(persisted) : undefined;
  if (depth) {
    override = depth;
  }
}
