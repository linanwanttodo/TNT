/**
 * Shared flag processing utilities to eliminate duplication between TUI and headless modes
 */

import { PermissionMode } from "../permissions/types.js";

export interface PermissionOverrides {
  allow?: string[];
  ask?: string[];
  exclude?: string[];
  mode?: PermissionMode;
}

export interface ProcessedFlags {
  mode?: PermissionMode;
  permissionOverrides: PermissionOverrides;
}

/**
 * Converts legacy readonly/auto flags to the new mode system
 * This logic was previously duplicated in chat.ts lines 168-173 and 259-264
 */
export function convertLegacyModeFlags(
  readonly?: boolean,
  auto?: boolean,
  mode?: string,
): PermissionMode | undefined {
  if (readonly && auto) {
    throw new Error("Cannot use both --readonly and --auto flags together");
  }

  if (mode) {
    if (readonly || auto) {
      throw new Error("Cannot use --mode together with --readonly or --auto");
    }
    if (mode !== "agent" && mode !== "plan" && mode !== "auto") {
      throw new Error(
        `Invalid --mode "${mode}". Expected one of: agent, plan, auto`,
      );
    }
    return mode;
  }

  if (readonly) {
    return "plan";
  }

  if (auto) {
    return "auto";
  }

  return undefined;
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
export function processCommandFlags(options: {
  readonly?: boolean;
  auto?: boolean;
  mode?: string;
  allow?: string[];
  ask?: string[];
  exclude?: string[];
}): ProcessedFlags {
  // Convert legacy flags to mode
  const mode = convertLegacyModeFlags(
    options.readonly,
    options.auto,
    options.mode,
  );

  // Build permission overrides
  const permissionOverrides = buildPermissionOverrides(
    options.allow,
    options.ask,
    options.exclude,
    mode,
  );

  return {
    mode,
    permissionOverrides,
  };
}
