import type { Theme } from "./tokens.js";

/**
 * The built-in palettes. They live apart from the registry so that file stays
 * inside the repository's line limit; `tokens.ts` re-exports the public ones,
 * so imports keep resolving from there.
 */
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
    warning: "gray",
    running: "gray",
    idle: "gray",
  },
  border: {
    default: "gray",
    focus: "#5ac8fa",
  },
  background: {
    composer: "#444444",
  },
  accent: "#5ac8fa",
  user: "blue",
  claude: "#5ac8fa",
  claudeShimmer: "#8ad9fb",
  permission: "#5ac8fa",
  suggestion: "#5ac8fa",
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
  syntaxName: "TNT Dark",
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
  background: {
    composer: "#252b3a",
  },
  accent: "#0052d9",
  user: "#366ef4",
  claude: "#0052d9",
  claudeShimmer: "#6ea6ff",
  permission: "#6ea6ff",
  suggestion: "#366ef4",
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
  syntaxName: "Tencent Dark",
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
  background: {
    composer: "#e4e4e4",
  },
  accent: "#0052d9",
  user: "#0052d9",
  claude: "#0052d9",
  claudeShimmer: "#366ef4",
  permission: "#0052d9",
  suggestion: "#0052d9",
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
  syntaxName: "Tencent Light",
};

/**
 * Claude Code Theme. The accent family is taken from the reference TUI:
 * the orange assistant colour, its shimmer, and the blue-purple shared by
 * permission prompts and suggestions. Tool, diff and syntax tokens follow the
 * dark terminal palette so code blocks stay legible without a second palette.
 */
export const claudeTheme: Theme = {
  text: {
    primary: "rgb(255,255,255)",
    secondary: "rgb(153,153,153)",
    subtle: "rgb(80,80,80)",
    inverse: "rgb(0,0,0)",
  },
  status: {
    success: "rgb(78,186,101)",
    error: "rgb(255,107,128)",
    warning: "rgb(153,153,153)",
    running: "rgb(215,119,87)",
    idle: "rgb(153,153,153)",
  },
  border: {
    default: "rgb(80,80,80)",
    focus: "rgb(177,185,249)",
  },
  background: {
    composer: "rgb(62,62,60)",
  },
  accent: "rgb(215,119,87)",
  user: "rgb(177,185,249)",
  claude: "rgb(215,119,87)",
  claudeShimmer: "rgb(245,149,117)",
  permission: "rgb(177,185,249)",
  suggestion: "rgb(177,185,249)",
  tool: { ...darkTheme.tool },
  diff: { ...darkTheme.diff },
  syntax: { ...darkTheme.syntax },
  syntaxName: "TNT Dark",
};

/**
 * Colorblind-friendly variants: the diff greens/reds become blue/orange so
 * deutan/protan readers can tell removed from added lines apart.
 */
export const darkColorblindTheme: Theme = {
  ...darkTheme,
  syntaxName: "TNT Dark (colorblind-friendly)",
  diff: {
    addBackground: "#3d2b14",
    addText: "#e0a45c",
    delBackground: "#1c2d4a",
    delText: "#7aa7e8",
    contextText: "white",
    gutterText: "gray",
    hunkBackground: "#1f242c",
    hunkText: "cyan",
  },
};

export const lightColorblindTheme: Theme = {
  ...tencentLightTheme,
  syntaxName: "TNT Light (colorblind-friendly)",
  diff: {
    addBackground: "#f5e8d5",
    addText: "#a35c1a",
    delBackground: "#dbe7f5",
    delText: "#2b5c8a",
    contextText: "#333333",
    gutterText: "#999999",
    hunkBackground: "#f0f2f5",
    hunkText: "#0052d9",
  },
};

/**
 * ANSI-only variants: every token maps to one of the terminal's own 16
 * colours, so a terminal that overrides its palette stays in control of the
 * exact shades.
 */
export const darkAnsiTheme: Theme = {
  ...darkTheme,
  syntaxName: "TNT Dark (ANSI)",
  text: {
    primary: "white",
    secondary: "gray",
    subtle: "blackBright",
    inverse: "black",
  },
  status: {
    success: "green",
    error: "redBright",
    warning: "yellow",
    running: "cyan",
    idle: "gray",
  },
  border: {
    default: "blackBright",
    focus: "cyanBright",
  },
  background: {
    composer: "blackBright",
  },
  accent: "cyan",
  user: "blue",
  claude: "cyan",
  claudeShimmer: "cyanBright",
  permission: "blue",
  suggestion: "cyan",
  tool: {
    pendingBackground: "blackBright",
    successBackground: "green",
    errorBackground: "red",
    canceledBackground: "yellow",
    output: "white",
    hint: "gray",
  },
  diff: {
    addBackground: "green",
    addText: "black",
    delBackground: "red",
    delText: "black",
    contextText: "white",
    gutterText: "gray",
    hunkBackground: "magenta",
    hunkText: "black",
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

export const lightAnsiTheme: Theme = {
  ...lightColorblindTheme,
  syntaxName: "TNT Light (ANSI)",
  text: {
    primary: "black",
    secondary: "blackBright",
    subtle: "blackBright",
    inverse: "white",
  },
  status: {
    success: "green",
    error: "red",
    warning: "yellow",
    running: "blue",
    idle: "blackBright",
  },
  border: {
    default: "blackBright",
    focus: "blue",
  },
  accent: "blue",
  user: "blue",
  claude: "blue",
  claudeShimmer: "magenta",
  permission: "blue",
  suggestion: "blue",
  diff: {
    addBackground: "green",
    addText: "black",
    delBackground: "red",
    delText: "black",
    contextText: "black",
    gutterText: "blackBright",
    hunkBackground: "magenta",
    hunkText: "black",
  },
  syntax: {
    keyword: "magenta",
    string: "green",
    comment: "blackBright",
    number: "yellow",
    operator: "black",
    punctuation: "black",
    function: "blue",
    variable: "black",
    property: "blue",
    class: "yellow",
    constant: "green",
    regex: "red",
    default: "black",
  },
};
