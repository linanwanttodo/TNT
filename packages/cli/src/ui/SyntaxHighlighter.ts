import { Text } from "ink";
import { common, createLowlight } from "lowlight";
import React from "react";

// One highlighter for the process: building it registers every common
// language, which is the expensive part, and streaming re-renders this file
// per chunk - a fresh instance per call made that cost pay every time.
const lowlight = createLowlight(common);

export interface SyntaxHighlighterTheme {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  operator: string;
  punctuation: string;
  function: string;
  variable: string;
  property: string;
  class: string;
  constant: string;
  regex: string;
  default: string;
}

export const defaultTheme: SyntaxHighlighterTheme = {
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
};

// Map highlight.js token types to theme colors
const tokenColorMap: Record<string, keyof SyntaxHighlighterTheme> = {
  keyword: "keyword",
  string: "string",
  comment: "comment",
  number: "number",
  operator: "operator",
  punctuation: "punctuation",
  function: "function",
  variable: "variable",
  property: "property",
  class: "class",
  constant: "constant",
  regexp: "regex",
  boolean: "constant",
  null: "constant",
  undefined: "constant",
  builtin: "keyword",
  tag: "keyword",
  attr: "property",
  attribute: "property",
  selector: "property",
  important: "keyword",
  atrule: "keyword",
  rule: "keyword",
  entity: "constant",
  url: "string",
  symbol: "constant",
  prolog: "comment",
  doctype: "comment",
  cdata: "comment",
  title: "function",
  section: "keyword",
  name: "function",
  strong: "keyword",
  emphasis: "string",
  quote: "string",
  built_in: "keyword",
  literal: "constant",
  type: "class",
  params: "variable",
  meta: "comment",
  link: "string",
};

export function highlightCode(
  code: string,
  language: string = "javascript",
  theme: SyntaxHighlighterTheme = defaultTheme,
  decoration?: {
    /** Background painted under every span, so highlighted code can sit on a
     * diff line's state colour without losing it between tokens. */
    backgroundColor?: string;
    dimColor?: boolean;
  },
): React.ReactNode[] {
  const decorate = (
    props: Record<string, unknown>,
  ): Record<string, unknown> => ({
    ...props,
    ...(decoration?.backgroundColor
      ? { backgroundColor: decoration.backgroundColor }
      : {}),
    ...(decoration?.dimColor ? { dimColor: true } : {}),
  });

  try {
    const result = lowlight.highlight(language, code, { prefix: "" });

    // Convert the hast tree to React elements
    const elements: React.ReactNode[] = [];

    let keyCounter = 0;

    function processNode(
      node: any,
      parentColor: string = theme.default,
    ): React.ReactNode {
      if (node.type === "text") {
        const text = node.value;
        if (text) {
          return React.createElement(
            Text,
            decorate({
              key: `text-${keyCounter++}`,
              color: parentColor,
            }),
            text,
          );
        }
        return null;
      }

      if (node.type === "element") {
        const className = node.properties?.className || [];

        // Extract token type from class names
        let tokenType = "";
        for (const cls of className) {
          if (tokenColorMap[cls]) {
            tokenType = cls;
            break;
          }
        }

        // Get color from theme
        const colorKey = tokenColorMap[tokenType] || "default";
        const color = theme[colorKey];

        if (node.children && node.children.length > 0) {
          // Process child nodes with this color
          const children: React.ReactNode[] = [];
          for (let i = 0; i < node.children.length; i++) {
            const child = processNode(node.children[i], color);
            if (!child) continue;

            if (Array.isArray(child)) {
              children.push(...child);
            } else {
              children.push(child);
            }
          }

          return children;
        }

        const textContent = getTextContent(node);
        if (textContent) {
          return React.createElement(
            Text,
            decorate({
              key: `element-${keyCounter++}`,
              color,
            }),
            textContent,
          );
        }
      }

      return null;
    }

    // Helper function to extract text content from a node
    function getTextContent(node: any): string {
      if (node.type === "text") {
        return node.value || "";
      }

      if (node.type === "element" && node.children) {
        return node.children.map(getTextContent).join("");
      }

      return "";
    }

    // Process all child nodes
    if (result.children) {
      for (let i = 0; i < result.children.length; i++) {
        const element = processNode(result.children[i]);
        if (!element) continue;

        if (Array.isArray(element)) {
          elements.push(...element);
        } else {
          elements.push(element);
        }
      }
    }

    return elements;
  } catch {
    // Fallback to plain text on error
    return [
      React.createElement(
        Text,
        decorate({
          key: "error-fallback",
          color: theme.default,
        }),
        code,
      ),
    ];
  }
}

/** Source-file extension to a lowlight language, for diff and preview use. */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  html: "xml",
  htm: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  lua: "lua",
  toml: "ini",
  ini: "ini",
};

/**
 * The lowlight language for a source path, or undefined when the extension is
 * unknown and the caller should fall back to plain text.
 */
export function languageFromFileName(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? "";
  if (/^dockerfile$/i.test(base)) {
    return "bash";
  }
  const ext = base.includes(".")
    ? base.split(".").pop()?.toLowerCase()
    : undefined;
  return ext ? EXTENSION_LANGUAGE[ext] : undefined;
}

/** The `+++ b/<path>` (or `--- a/<path>`) header of a unified diff, if any. */
export function diffFilePath(diffText: string): string | undefined {
  for (const line of diffText.split("\n")) {
    const plus = line.match(/^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/);
    if (plus && plus[1] !== "/dev/null") {
      return plus[1];
    }
    const minus = line.match(/^--- (?:a\/)?(.+?)(?:\t.*)?$/);
    if (minus && minus[1] !== "/dev/null") {
      return minus[1];
    }
  }
  return undefined;
}

export function detectLanguage(code: string): string {
  // Simple language detection based on common patterns
  const patterns = [
    { regex: /^\s*import\s+.*from\s+['"]/, language: "javascript" },
    { regex: /^\s*const\s+\w+\s*=\s*require\s*\(/, language: "javascript" },
    { regex: /^\s*function\s+\w+\s*\(/, language: "javascript" },
    { regex: /^\s*interface\s+\w+/, language: "typescript" },
    { regex: /^\s*type\s+\w+\s*=/, language: "typescript" },
    { regex: /^\s*def\s+\w+.*:/, language: "python" },
    { regex: /^\s*class\s+\w+.*:/, language: "python" },
    { regex: /^\s*public\s+class\s+\w+/, language: "java" },
    { regex: /^\s*#include\s*</, language: "c" },
    { regex: /^\s*using\s+namespace\s+/, language: "cpp" },
    { regex: /^\s*using\s+System\s*;/, language: "csharp" },
    { regex: /^\s*package\s+main/, language: "go" },
    { regex: /^\s*fn\s+\w+\s*\(/, language: "rust" },
    { regex: /^\s*<\?php/, language: "php" },
    { regex: /^\s*SELECT\s+.*FROM\s+/i, language: "sql" },
    { regex: /^\s*\{\s*$/, language: "json" },
    { regex: /^\s*---\s*$/, language: "yaml" },
    { regex: /^\s*#!/, language: "bash" },
    { regex: /^\s*<(!DOCTYPE html|html)/i, language: "html" },
    { regex: /^\s*@media\s+/, language: "css" },
    { regex: /^\s*#\s+/, language: "markdown" },
  ];

  // Check patterns line by line for multiline code
  const lines = code.split("\n");
  for (const line of lines) {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        return pattern.language;
      }
    }
  }

  return "javascript"; // default fallback
}
