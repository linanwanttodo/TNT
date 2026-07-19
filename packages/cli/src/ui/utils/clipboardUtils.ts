/**
 * Ported from gemini-cli (packages/cli/src/ui/utils/clipboardUtils.ts):
 * drag-and-drop path parsing used by the text buffer. Only the path helpers
 * the composer needs were kept.
 */

import { existsSync, statSync } from "node:fs";

const PATH_PREFIX_PATTERN = /^([/~.]|[a-zA-Z]:|\\\\)/;

export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".heic",
  ".heif",
];

/**
 * Escapes a path so it can be referenced after an `@` in the composer.
 * Paths with whitespace are wrapped in single quotes, POSIX style.
 */
export function escapePath(p: string): string {
  if (process.platform === "win32") {
    if (p.includes(" ")) {
      return `"${p}"`;
    }
    return p;
  }
  if (/[\s'"\\]/.test(p)) {
    return `'${p.replaceAll("'", "'\\''")}'`;
  }
  return p;
}

/**
 * Splits a drag-and-drop payload into individual paths, honoring the shell
 * style quoting terminals apply: single quotes, double quotes and POSIX
 * backslash escapes. Windows paths arrive unwrapped, so double quotes are
 * treated as plain delimiters there as well.
 */
export function* splitDragAndDropPaths(text: string): Generator<string> {
  let current = "";
  let mode: "NORMAL" | "DOUBLE" | "SINGLE" = "NORMAL";
  const isWindows = process.platform === "win32";

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (mode === "NORMAL") {
      if (char === " ") {
        if (current.length > 0) {
          yield current;
          current = "";
        }
      } else if (char === '"') {
        mode = "DOUBLE";
      } else if (char === "'") {
        mode = "SINGLE";
      } else if (char === "\\" && !isWindows) {
        if (i + 1 < text.length) {
          const next = text[i + 1];
          current += next;
          i++;
        }
      } else {
        current += char;
      }
    } else if (mode === "DOUBLE") {
      if (char === '"') {
        mode = "NORMAL";
      } else {
        current += char;
      }
    } else if (mode === "SINGLE") {
      if (char === "'") {
        mode = "NORMAL";
      } else {
        current += char;
      }
    }

    i++;
  }

  if (current.length > 0) {
    yield current;
  }
}

/**
 * Helper to validate if a path exists and is a file.
 */
function isValidFilePath(p: string): boolean {
  try {
    return PATH_PREFIX_PATTERN.test(p) && existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Processes pasted text containing file paths (like those from drag and
 * drop), adding @ prefixes to valid paths and escaping them in a standard
 * way.
 */
export function parsePastedPaths(text: string): string | null {
  if (isValidFilePath(text)) {
    return `@${escapePath(text)} `;
  }

  const validPaths = [];
  for (const segment of splitDragAndDropPaths(text)) {
    if (isValidFilePath(segment)) {
      validPaths.push(`@${escapePath(segment)}`);
    } else {
      return null;
    }
  }
  if (validPaths.length === 0) {
    return null;
  }
  return validPaths.join(" ") + " ";
}
