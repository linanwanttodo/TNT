import {
  getProjectSettingsPath,
  readSettingsBoolean,
  writeSettingsValue,
} from "../config/settingsFiles.js";

const SETTINGS_KEY = "userBrief";

/**
 * The live session choice. `/brief` sets it, and it wins over the settings
 * file for the rest of the process, the same way `/think` pins its depth.
 * Undefined means "read the persisted setting".
 */
let sessionOverride: boolean | undefined;

/** On unless a settings file says off. */
export function getUserBriefEnabled(): boolean {
  if (sessionOverride !== undefined) return sessionOverride;
  return readSettingsBoolean(SETTINGS_KEY) ?? true;
}

export function setUserBriefEnabled(enabled: boolean): void {
  sessionOverride = enabled;
}

/** Persists the choice so it survives a restart. Throws on an unwritable file. */
export function saveUserBriefEnabled(enabled: boolean): void {
  sessionOverride = enabled;
  writeSettingsValue(getProjectSettingsPath(), SETTINGS_KEY, enabled);
}

/** Drops the process-local choice; tests use it to isolate themselves. */
export function resetUserBriefOverride(): void {
  sessionOverride = undefined;
}
