import fs from "fs";
import path from "path";

import React, { createContext, useContext, type ReactNode } from "react";

import { globalDir } from "../../config/globalDir.js";
import { logger } from "../../utils/logger.js";
import type { SyntaxHighlighterTheme } from "../SyntaxHighlighter.js";

import { mergeTheme, readThemeFile } from "./externalTheme.js";
import {
  claudeTheme,
  darkAnsiTheme,
  darkColorblindTheme,
  darkTheme,
  lightAnsiTheme,
  lightColorblindTheme,
  tencentDarkTheme,
  tencentLightTheme,
} from "./presets.js";

/**
 * The palettes moved to `presets.ts` to stay under the line limit; the ones
 * that were public are re-exported here so existing imports keep resolving.
 */
export {
  claudeTheme,
  darkTheme,
  tencentDarkTheme,
  tencentLightTheme,
} from "./presets.js";

/**
 * Semantic color tokens for the terminal UI.
 * Strictly adheres to Tencent UI design guidelines:
 * - Solid flat background colors only.
 * - No gradient colors.
 * - No hover effects.
 */
export interface Theme {
  text: {
    primary: string;
    secondary: string;
    subtle: string;
    inverse?: string;
  };
  status: {
    success: string;
    error: string;
    warning: string;
    running: string;
    idle: string;
  };
  border: {
    default: string;
    focus: string;
  };
  /** The composer input box surface. */
  background: {
    composer: string;
  };
  accent: string;
  user: string;
  /** The assistant identity colour, e.g. the tool-call dot. */
  claude: string;
  /** The lighter tint the working indicator alternates to. */
  claudeShimmer: string;
  /** Permission prompts and question navigation. */
  permission: string;
  /** Inline suggestions in the composer. */
  suggestion: string;
  /** Code highlight colours for fenced blocks and diff context lines. */
  syntax: SyntaxHighlighterTheme;
  /** Display name of the syntax palette, shown in the theme picker footer. */
  syntaxName: string;
  tool: {
    pendingBackground: string;
    successBackground: string;
    errorBackground: string;
    canceledBackground: string;
    output: string;
    hint: string;
  };
  diff: {
    addBackground: string;
    addText: string;
    delBackground: string;
    delText: string;
    contextText: string;
    gutterText: string;
    hunkBackground: string;
    hunkText: string;
  };
}

export type BuiltInThemeName =
  | "dark"
  | "light"
  | "dark-colorblind"
  | "light-colorblind"
  | "dark-ansi"
  | "light-ansi"
  | "tencent-dark"
  | "tencent-light"
  | "claude";

/**
 * A built-in name, or the name of a file under `<home>/themes/<name>.json`.
 * The `string & {}` keeps the built-in names completing while letting a user's
 * own theme name through - a closed union would silently rewrite it to `dark`.
 */
export type ThemeName = BuiltInThemeName | (string & {});

export const themes: Record<BuiltInThemeName, Theme> = {
  dark: darkTheme,
  light: tencentLightTheme,
  "dark-colorblind": darkColorblindTheme,
  "light-colorblind": lightColorblindTheme,
  "dark-ansi": darkAnsiTheme,
  "light-ansi": lightAnsiTheme,
  "tencent-dark": tencentDarkTheme,
  "tencent-light": tencentLightTheme,
  claude: claudeTheme,
};

/**
 * Returns the theme matching the provided name.
 * Falls back to darkTheme if unknown or unspecified.
 */
export function themeFileFor(name: string): string {
  return path.join(globalDir(), "themes", `${name}.json`);
}

/**
 * A file theme is read once per modification: the palette is resolved on every
 * render, and a theme file is small enough that re-reading it is not a feature.
 */
const fileThemes = new Map<string, { at: number; theme: Theme }>();

export function getTheme(name?: string): Theme {
  if (!name) return darkTheme;
  const normalized = name.toLowerCase().trim();
  if (normalized in themes) {
    return themes[normalized as BuiltInThemeName];
  }
  const fromFile = externalTheme(normalized);
  if (fromFile) {
    return fromFile;
  }
  if (normalized.includes("light")) {
    return tencentLightTheme;
  }
  if (normalized.includes("tencent")) {
    return tencentDarkTheme;
  }
  return darkTheme;
}

function externalTheme(name: string): Theme | undefined {
  const file = themeFileFor(name);
  let modified: number;
  try {
    modified = fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  const cached = fileThemes.get(file);
  if (cached && cached.at === modified) {
    return cached.theme;
  }

  const { overrides, rejected, problem } = readThemeFile(file);
  if (problem || !overrides) {
    if (problem) logger.debug(`Theme ${name}: ${problem}`);
    return undefined;
  }
  if (rejected.length > 0) {
    // Named, because a typo in a colour that silently does nothing is the
    // failure mode a theme file has.
    logger.debug(`Theme ${name}: ignoring ${rejected.join(", ")}`);
  }
  const theme = mergeTheme(darkTheme, overrides);
  fileThemes.set(file, { at: modified, theme });
  return theme;
}

/** Default theme reference for backward compatibility */
export const theme: Theme = darkTheme;

const ThemeContext = createContext<Theme>(darkTheme);

export interface ThemeProviderProps {
  theme?: Theme | ThemeName;
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  theme: customTheme = darkTheme,
  children,
}) => {
  const resolved =
    typeof customTheme === "string" ? getTheme(customTheme) : customTheme;
  return React.createElement(
    ThemeContext.Provider,
    { value: resolved },
    children,
  );
};

/** Hook to access current theme tokens */
export function useTheme(): Theme {
  return useContext(ThemeContext) ?? darkTheme;
}
