import fs from "fs";
import os from "os";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { getPluginSettingsBase } from "../plugins/pluginSettings.js";

/**
 * The settings files TNT reads, lowest precedence first. Hooks and the
 * session defaults both come from here, so the list exists once: a second copy
 * is how one of them silently stops honouring a file.
 */
export function getSettingsFilePaths(
  cwd: string = process.cwd(),
  homeDir?: string,
): string[] {
  const home = homeDir ?? os.homedir();
  const continueHome =
    process.env.CONTINUE_GLOBAL_DIR || path.join(home, ".tnt");

  return [
    // User-global (lowest precedence)
    path.join(home, ".claude", "settings.json"),
    path.join(continueHome, "settings.json"),

    // Project-level
    path.join(cwd, ".claude", "settings.json"),
    path.join(cwd, ".tnt", "settings.json"),

    // Project-local (highest precedence)
    path.join(cwd, ".claude", "settings.local.json"),
    path.join(cwd, ".tnt", "settings.local.json"),
  ];
}

export function readSettingsFile(
  filePath: string,
): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    // A malformed settings file must not take down the session; the next file
    // in the list still applies.
    return null;
  }
}

/** The project settings file the CLI writes to: committable, not local. */
export function getProjectSettingsPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".tnt", "settings.json");
}

/** Writes one key into a settings file, keeping every other key in it. */
export function writeSettingsValue(
  filePath: string,
  key: string,
  value: unknown,
): void {
  const existing = readSettingsFile(filePath) ?? {};
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomically(
    filePath,
    `${JSON.stringify({ ...existing, [key]: value }, null, 2)}\n`,
  );
}

/**
 * Highest-precedence non-empty string value for a key across the settings
 * files. Returns undefined when no file defines it.
 */
export function readSettingsString(
  key: string,
  cwd: string = process.cwd(),
  homeDir?: string,
): string | undefined {
  let value: string | undefined;
  for (const filePath of getSettingsFilePaths(cwd, homeDir)) {
    const settings = readSettingsFile(filePath);
    const candidate = settings?.[key];
    if (typeof candidate === "string" && candidate.trim()) {
      value = candidate.trim();
    }
  }
  if (value === undefined) {
    // The lowest layer: defaults an installed plugin declares. Every settings
    // file outranks them, so a plugin ships defaults rather than decisions.
    const fromPlugins = getPluginSettingsBase()?.[key];
    if (typeof fromPlugins === "string" && fromPlugins.trim()) {
      value = fromPlugins.trim();
    }
  }
  return value;
}
