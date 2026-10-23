import { currentPromptCacheKey } from "../cache/promptCacheKey.js";
import type { PermissionMode } from "../permissions/types.js";
import { services } from "../services/index.js";

/**
 * What a run must not re-read from mutable services halfway through.
 *
 * A mode switch or a permission reload during a turn used to change the system
 * prompt and the request header between rounds. The snapshot freezes those
 * inputs when the run starts; a later turn sees the new value.
 */
export interface RunConfigSnapshot {
  readonly revision: number;
  readonly sessionId: string;
  readonly mode: PermissionMode;
  readonly isHeadless: boolean;
}

let revision = 0;
let current: RunConfigSnapshot | null = null;

function readMode(): PermissionMode {
  try {
    return services.toolPermissions.getState().currentMode;
  } catch {
    return "default";
  }
}

function readHeadless(): boolean {
  try {
    return services.toolPermissions.isHeadless();
  } catch {
    return false;
  }
}

/** Captures the current inputs and returns an immutable snapshot. */
export function captureRunSnapshot(
  overrides: Partial<
    Pick<RunConfigSnapshot, "sessionId" | "mode" | "isHeadless">
  > = {},
): RunConfigSnapshot {
  revision += 1;
  current = Object.freeze({
    revision,
    sessionId: overrides.sessionId ?? currentPromptCacheKey() ?? "session",
    mode: overrides.mode ?? readMode(),
    isHeadless: overrides.isHeadless ?? readHeadless(),
  });
  return current;
}

export function getRunSnapshot(): RunConfigSnapshot {
  return current ?? captureRunSnapshot();
}

/** Test and session cleanup. */
export function resetRunSnapshot(): void {
  revision = 0;
  current = null;
}
