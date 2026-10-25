import React, { createContext, useContext, type ReactNode } from "react";

import type { SyntaxHighlighterTheme } from "../SyntaxHighlighter.js";

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
  accent: string;
  user: string;
  /** Code highlight colours for fenced blocks and diff context lines. */
  syntax: SyntaxHighlighterTheme;
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

/** Standard Dark Theme (default terminal theme) */
export const darkTheme: Theme = {
  text: {
    primary: "white",
    secondary: "gray",
    subtle: "gray",
    inverse: "black",
  },
  status: {
    success: "green",
    error: "red",
    warning: "yellow",
    running: "yellow",
    idle: "gray",
  },
  border: {
    default: "gray",
    focus: "#5ac8fa",
  },
  accent: "#5ac8fa",
  user: "blue",
  tool: {
    pendingBackground: "#1c1c1c",
    successBackground: "#10261a",
    errorBackground: "#2a1214",
    canceledBackground: "#262011",
    output: "white",
    hint: "gray",
  },
  diff: {
    addBackground: "#163b24",
    addText: "greenBright",
    delBackground: "#3b1a1e",
    delText: "redBright",
    contextText: "white",
    gutterText: "gray",
    hunkBackground: "#1f242c",
    hunkText: "cyan",
  },
  syntax: {
    keyword: "magenta",
    string: "green",
    comment: "gray",
    number: "cyan",
    operator: "white",
    punctuation: "white",
    function: "yellow",
    variable: "white",
    property: "blue",
    class: "yellow",
    constant: "cyan",
    regex: "red",
    default: "white",
  },
};

/** Tencent Design Dark Theme (Flat solid colors, Tencent Blue brand accent) */
export const tencentDarkTheme: Theme = {
  text: {
    primary: "#e7e9eb",
    secondary: "#8b949e",
    subtle: "#586069",
    inverse: "#161b22",
  },
  status: {
    success: "#2ba471",
    error: "#d54941",
    warning: "#e37318",
    running: "#0052d9",
    idle: "#8b949e",
  },
  border: {
    default: "#30363d",
    focus: "#0052d9",
  },
  accent: "#0052d9",
  user: "#366ef4",
  tool: {
    pendingBackground: "#1a1f2c",
    successBackground: "#12291e",
    errorBackground: "#2e1518",
    canceledBackground: "#2b2214",
    output: "#e7e9eb",
    hint: "#8b949e",
  },
  diff: {
    addBackground: "#133820",
    addText: "#48d597",
    delBackground: "#38191d",
    delText: "#f56c6c",
    contextText: "#c9d1d9",
    gutterText: "#6e7681",
    hunkBackground: "#1c222b",
    hunkText: "#0052d9",
  },
  syntax: {
    keyword: "#6ea6ff",
    string: "#48d597",
    comment: "#6e7681",
    number: "#e3b341",
    operator: "#c9d1d9",
    punctuation: "#8b949e",
    function: "#79c0ff",
    variable: "#e7e9eb",
    property: "#9ecbff",
    class: "#e3b341",
    constant: "#48d597",
    regex: "#f56c6c",
    default: "#e7e9eb",
  },
};

/** Tencent Design Light Theme (Flat solid colors, high readability) */
export const tencentLightTheme: Theme = {
  text: {
    primary: "#181818",
    secondary: "#666666",
    subtle: "#999999",
    inverse: "#ffffff",
  },
  status: {
    success: "#2ba471",
    error: "#d54941",
    warning: "#e37318",
    running: "#0052d9",
    idle: "#999999",
  },
  border: {
    default: "#dcdcdc",
    focus: "#0052d9",
  },
  accent: "#0052d9",
  user: "#0052d9",
  tool: {
    pendingBackground: "#f2f3f5",
    successBackground: "#e8f8f2",
    errorBackground: "#feecee",
    canceledBackground: "#fef3e6",
    output: "#181818",
    hint: "#666666",
  },
  diff: {
    addBackground: "#e8f8f2",
    addText: "#188050",
    delBackground: "#feecee",
    delText: "#c0352b",
    contextText: "#333333",
    gutterText: "#999999",
    hunkBackground: "#f0f2f5",
    hunkText: "#0052d9",
  },
  syntax: {
    keyword: "#0052d9",
    string: "#188050",
    comment: "#999999",
    number: "#b26818",
    operator: "#333333",
    punctuation: "#666666",
    function: "#366ef4",
    variable: "#181818",
    property: "#0052d9",
    class: "#b26818",
    constant: "#188050",
    regex: "#c0352b",
    default: "#181818",
  },
};

export type ThemeName = "dark" | "tencent-dark" | "tencent-light" | "light";

export const themes: Record<ThemeName, Theme> = {
  dark: darkTheme,
  "tencent-dark": tencentDarkTheme,
  "tencent-light": tencentLightTheme,
  light: tencentLightTheme,
};

/**
 * Returns the theme matching the provided name.
 * Falls back to darkTheme if unknown or unspecified.
 */
export function getTheme(name?: string): Theme {
  if (!name) return darkTheme;
  const normalized = name.toLowerCase().trim();
  if (normalized in themes) {
    return themes[normalized as ThemeName];
  }
  if (normalized.includes("light")) {
    return tencentLightTheme;
  }
  if (normalized.includes("tencent")) {
    return tencentDarkTheme;
  }
  return darkTheme;
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
