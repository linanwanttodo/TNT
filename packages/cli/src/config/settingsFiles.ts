import fs from "fs";
import os from "os";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { t } from "../i18n/index.js";
import { getPluginSettingsBase } from "../plugins/pluginSettings.js";

import { globalDir } from "./globalDir.js";
import { isProjectTrusted, projectConfigFiles } from "./trust.js";

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
  const continueHome = globalDir(home);

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

let warnedUntrustedProject = false;

/**
 * The settings files that may apply right now. User-global layers always do;
 * project layers only after `--trust-project` (or TNT_TRUST_PROJECT=1) has
 * recorded the current contents. An untrusted project gets one notice per
 * process rather than a per-reader warning.
 */
export function getEffectiveSettingsFilePaths(
  cwd: string = process.cwd(),
  homeDir?: string,
): string[] {
  const paths = getSettingsFilePaths(cwd, homeDir);
  const trustable = projectConfigFiles(cwd);
  if (trustable.length === 0 || isProjectTrusted(cwd)) return paths;

  if (!warnedUntrustedProject) {
    warnedUntrustedProject = true;
    console.warn(t("settings.untrustedProject", { path: cwd }));
  }

  const home = homeDir ?? os.homedir();
  const userOnly = new Set([
    path.join(home, ".claude", "settings.json"),
    path.join(globalDir(home), "settings.json"),
  ]);
  return paths.filter((filePath) => userOnly.has(filePath));
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

/**
 * The list value of a key across the settings files. A later file replaces an
 * earlier one rather than merging: a list here is a decision ("these may load"),
 * and a merge would silently add to it. Strings are trimmed and empties dropped;
 * anything that is not a list of strings is ignored rather than guessed at.
 */
export function readSettingsStringArray(
  key: string,
  cwd: string = process.cwd(),
  homeDir?: string,
): string[] | undefined {
  let value: string[] | undefined;
  for (const filePath of getSettingsFilePaths(cwd, homeDir)) {
    const settings = readSettingsFile(filePath);
    const candidate = settings?.[key];
    if (Array.isArray(candidate)) {
      value = candidate
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
    }
  }
  return value;
}
