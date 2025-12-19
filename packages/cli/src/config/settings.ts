import fs from "fs";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { t } from "../i18n/index.js";
import {
  loadPermissionsYaml,
  parseToolPattern,
  yamlConfigToPolicies,
} from "../permissions/permissionsYamlLoader.js";
import { withPermissionWriteLock } from "../permissions/permissionWriteLock.js";
import type { ToolPermissionPolicy } from "../permissions/types.js";
import { logger } from "../utils/logger.js";

import { env } from "./env.js";
import {
  getEffectiveSettingsFilePaths,
  readSettingsFile,
} from "./settingsFiles.js";

export interface SettingsPermissions {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

/**
 * The user-owned settings file. Model definitions and the current model live in
 * config.yaml; this file deliberately has no model fields.
 */
export interface TntSettings {
  permissions?: SettingsPermissions;
  hooks?: Record<string, unknown>;
  env?: Record<string, string>;
  locale?: string;
  outputStyle?: string;
  defaultMode?: string;
}

const PERMISSION_LISTS = ["allow", "ask", "deny"] as const;

export function settingsPath(continueHome = env.continueHome): string {
  return path.resolve(path.join(continueHome, "settings.json"));
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isValidSettings(value: unknown): value is TntSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;

  if (settings.permissions !== undefined) {
    if (
      !settings.permissions ||
      typeof settings.permissions !== "object" ||
      Array.isArray(settings.permissions)
    ) {
      return false;
    }
    const permissions = settings.permissions as Record<string, unknown>;
    if (
      Object.keys(permissions).some(
        (key) => !PERMISSION_LISTS.includes(key as never),
      )
    ) {
      return false;
    }
    if (
      PERMISSION_LISTS.some(
        (key) =>
          permissions[key] !== undefined && !isStringArray(permissions[key]),
      )
    ) {
      return false;
    }
  }

  if (settings.hooks !== undefined && typeof settings.hooks !== "object") {
    return false;
  }
  if (settings.env !== undefined) {
    if (
      !settings.env ||
      typeof settings.env !== "object" ||
      Array.isArray(settings.env)
    ) {
      return false;
    }
    if (
      Object.values(settings.env as Record<string, unknown>).some(
        (value) => typeof value !== "string",
      )
    ) {
      return false;
    }
  }
  for (const key of ["locale", "outputStyle", "defaultMode"] as const) {
    if (settings[key] !== undefined && typeof settings[key] !== "string") {
      return false;
    }
  }

  return true;
}

/**
 * Model definitions and the current model live in config.yaml. A settings file
 * that carries them has those two keys dropped with a warning; the rest of the
 * file still applies.
 */
function sanitizeSettings(parsed: unknown, file: string): TntSettings | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const copy = { ...(parsed as Record<string, unknown>) };
  if ("model" in copy || "models" in copy) {
    delete copy.model;
    delete copy.models;
    logger.warn("Ignoring model fields in settings.json", { path: file });
  }
  if (!isValidSettings(copy)) {
    logger.warn("Invalid settings.json structure", { path: file });
    return null;
  }
  return copy as TntSettings;
}

/**
 * Reads every settings file in precedence order (user, project, project-local,
 * including the read-only .claude variants) and merges top-level keys, later
 * files winning. Permissions keep their per-tool layering through
 * loadPermissionPoliciesFromSettings.
 */
export function loadSettings(cwd = process.cwd()): TntSettings {
  let merged: TntSettings = {};
  for (const file of getEffectiveSettingsFilePaths(cwd)) {
    const parsed = readSettingsFile(file);
    if (!parsed) continue;
    const settings = sanitizeSettings(parsed, file);
    if (settings) merged = { ...merged, ...settings };
  }
  return merged;
}

/** deny is Claude's name for what the policy layer calls exclude. */
export function settingsPermissionsToPolicies(
  permissions: SettingsPermissions,
): ToolPermissionPolicy[] {
  const policies: ToolPermissionPolicy[] = [];
  for (const pattern of permissions.deny ?? []) {
    policies.push(parseToolPattern(pattern, "exclude"));
  }
  for (const pattern of permissions.ask ?? []) {
    policies.push(parseToolPattern(pattern, "ask"));
  }
  for (const pattern of permissions.allow ?? []) {
    policies.push(parseToolPattern(pattern, "allow"));
  }
  return policies;
}

let warnedLegacyPermissions = false;

/**
 * The permissions layer seen by the resolver. settings.json wins; when it has
 * no permissions section, permissions.yaml is read once with a deprecation
 * warning and never written again.
 */
export function loadPermissionPoliciesFromSettings(
  cwd = process.cwd(),
): ToolPermissionPolicy[] | null {
  // Highest precedence first: a project-local rule beats a project rule, which
  // beats a user rule for the same tool, while unmentioned tools keep falling
  // through to the lower layers.
  const layered: ToolPermissionPolicy[] = [];
  for (const file of getEffectiveSettingsFilePaths(cwd).reverse()) {
    const parsed = readSettingsFile(file);
    if (!parsed) continue;
    const settings = sanitizeSettings(parsed, file);
    if (settings?.permissions) {
      layered.push(...settingsPermissionsToPolicies(settings.permissions));
    }
  }
  if (layered.length > 0) return layered;

  const legacy = loadPermissionsYaml();
  if (!legacy) return null;

  if (!warnedLegacyPermissions) {
    warnedLegacyPermissions = true;
    console.warn(t("settings.legacyPermissions"));
  }
  return yamlConfigToPolicies(legacy);
}

/**
 * Appends a rule to the user's settings.json permissions.allow. The
 * read-modify-write runs under the same lock the old YAML writer used, and the
 * write is atomic.
 */
export async function addSettingsPolicyRule(rule: string): Promise<void> {
  const file = settingsPath();
  await withPermissionWriteLock(`${file}.lock`, async () => {
    const settings = readSettingsFile(file)
      ? (JSON.parse(fs.readFileSync(file, "utf-8")) as TntSettings)
      : {};
    const allow = settings.permissions?.allow ?? [];
    if (allow.includes(rule)) return;

    const next: TntSettings = {
      ...settings,
      permissions: {
        ...settings.permissions,
        allow: [...allow, rule],
      },
    };
    writeFileAtomically(file, `${JSON.stringify(next, null, 2)}\n`);
    logger.info(`Added policy rule to settings.json: ${rule}`);
  });
}
