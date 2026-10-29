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

const EFFORT_VALUES: ReasoningDepth[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

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
  const normalized = value.trim().toLowerCase();
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
