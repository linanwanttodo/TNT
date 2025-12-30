/**
 * Shared flag processing utilities to eliminate duplication between TUI and headless modes
 */

import { t } from "../i18n/index.js";
import { PERMISSION_MODES, PermissionMode } from "../permissions/types.js";

export interface PermissionOverrides {
  allow?: string[];
  ask?: string[];
  exclude?: string[];
  mode?: PermissionMode;
}

export interface ProcessedFlags {
  mode?: PermissionMode;
  warnings: string[];
  permissionOverrides: PermissionOverrides;
}

export interface ModeInput {
  /** The Claude-compatible entry point. */
  permissionMode?: string;
  /** Legacy TNT entries. */
  readonly?: boolean;
  auto?: boolean;
  mode?: string;
  /** Explicit opt-in for bypassPermissions. */
  dangerouslySkipPermissions?: boolean;
  /** settings.json's defaultMode, consulted only after the flags and the env. */
  settingsDefaultMode?: string;
  env?: NodeJS.ProcessEnv;
}

const LEGACY_MODE_ALIASES: Record<string, PermissionMode> = {
  agent: "default",
  plan: "plan",
  auto: "bypassPermissions",
};

function stripPrefix(message: string): string {
  return message.replace(/^Error: /, "");
}

/** A Claude mode value; `auto` parses but is refused until implemented. */
function requireKnownMode(value: string): PermissionMode {
  if (!PERMISSION_MODES.includes(value as PermissionMode)) {
    throw new Error(stripPrefix(t("cli.invalidPermissionMode", { value })));
  }
  if (value === "auto") {
    throw new Error(stripPrefix(t("cli.autoModeUnavailable")));
  }
  return value as PermissionMode;
}

function modeFromEnv(env: NodeJS.ProcessEnv): PermissionMode | undefined {
  const value = env.TNT_PERMISSION_MODE ?? env.CLAUDE_CODE_PERMISSION_MODE;
  return value ? requireKnownMode(value) : undefined;
}

/** settings.json's defaultMode obeys the same mode table as the flag. */
function requireSettingsMode(value: string): PermissionMode {
  if (!PERMISSION_MODES.includes(value as PermissionMode)) {
    throw new Error(stripPrefix(t("settings.invalidDefaultMode", { value })));
  }
  if (value === "auto") {
    throw new Error(stripPrefix(t("settings.autoDefaultModeUnavailable")));
  }
  return value as PermissionMode;
}

/**
 * Resolves the effective permission mode from the Claude entry point, the
 * legacy flags, and the two environment variables. The result carries the
 * messages a caller should print: the legacy aliases still work, but silently
 * mapping them would hide that the user asked for something else.
 */
export function resolveModeFromFlags(input: ModeInput): {
  mode?: PermissionMode;
  warnings: string[];
} {
  const { permissionMode, readonly, auto, mode, dangerouslySkipPermissions } =
    input;
  const env = input.env ?? process.env;
  const warnings: string[] = [];

  if (readonly && auto) {
    throw new Error(t("cli.readonlyAutoConflict"));
  }
  if (mode && (readonly || auto)) {
    throw new Error(stripPrefix(t("cli.modeConflictsWithReadonlyAuto")));
  }
  if (permissionMode && (readonly || auto || mode)) {
    throw new Error(stripPrefix(t("cli.permissionModeConflicts")));
  }

  if (permissionMode) {
    const mode = requireKnownMode(permissionMode);
    if (mode === "bypassPermissions" && !dangerouslySkipPermissions) {
      // TNT_PERMISSION_MODE is the "setting" half of the gate; an explicit
      // --permission-mode on its own is not enough.
      const fromEnv = env.TNT_PERMISSION_MODE === "bypassPermissions";
      if (!fromEnv) {
        throw new Error(stripPrefix(t("cli.bypassModeRequiresFlag")));
      }
    }
    if (dangerouslySkipPermissions && mode !== "bypassPermissions") {
      throw new Error(stripPrefix(t("cli.permissionModeConflicts")));
    }
    return { mode, warnings };
  }

  if (dangerouslySkipPermissions) {
    if (readonly || auto || mode) {
      throw new Error(stripPrefix(t("cli.permissionModeConflicts")));
    }
    return { mode: "bypassPermissions", warnings };
  }

  if (mode) {
    const mapped = LEGACY_MODE_ALIASES[mode];
    if (!mapped) {
      throw new Error(stripPrefix(t("cli.invalidMode", { value: mode })));
    }
    warnings.push(
      t("cli.deprecatedModeAlias", { from: `--mode ${mode}`, to: mapped }),
    );
    return { mode: mapped, warnings };
  }

  if (readonly) {
    warnings.push(
      t("cli.deprecatedModeAlias", { from: "--readonly", to: "plan" }),
    );
    return { mode: "plan", warnings };
  }

  if (auto) {
    warnings.push(
      t("cli.deprecatedModeAlias", {
        from: "--auto",
        to: "bypassPermissions",
      }),
    );
    return { mode: "bypassPermissions", warnings };
  }

  const envMode = modeFromEnv(env);
  if (envMode) {
    return { mode: envMode, warnings };
  }

  if (input.settingsDefaultMode) {
    // A persisted bypassPermissions is an explicit setting, like
    // TNT_PERMISSION_MODE, so it does not need the flag opt-in.
    return { mode: requireSettingsMode(input.settingsDefaultMode), warnings };
  }

  return { mode: undefined, warnings };
}

/**
 * Converts legacy readonly/auto flags to the new mode system.
 * Kept for callers that only need the resolved value.
 */
export function convertLegacyModeFlags(
  readonly?: boolean,
  auto?: boolean,
  mode?: string,
): PermissionMode | undefined {
  return resolveModeFromFlags({ readonly, auto, mode, env: {} }).mode;
}

/**
 * Structures permission overrides for service initialization
 * This logic was previously duplicated between TUI and headless paths
 */
export function buildPermissionOverrides(
  allow?: string[],
  ask?: string[],
  exclude?: string[],
  mode?: PermissionMode,
): PermissionOverrides {
  return {
    allow,
    ask,
    exclude,
    mode,
  };
}

/**
 * Processes all command line flags into a consistent structure
 * Eliminates duplication and provides single source of truth for flag processing
 */
export function processCommandFlags(
  options: {
    permissionMode?: string;
    readonly?: boolean;
    auto?: boolean;
    mode?: string;
    dangerouslySkipPermissions?: boolean;
    allow?: string[];
    ask?: string[];
    exclude?: string[];
  },
  settingsDefaultMode?: string,
): ProcessedFlags {
  const { mode, warnings } = resolveModeFromFlags({
    ...options,
    settingsDefaultMode,
  });

  const permissionOverrides = buildPermissionOverrides(
    options.allow,
    options.ask,
    options.exclude,
    mode,
  );

  return {
    mode,
    warnings,
    permissionOverrides,
  };
}
