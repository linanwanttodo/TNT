import fs from "fs";

import type { Theme } from "./tokens.js";

/**
 * A user theme file, merged over a built-in one.
 *
 * The tokens are the contract: a file may set any of them and inherits the rest,
 * so a theme that only wants a different accent is three lines rather than a
 * copy of the whole palette. A value the palette cannot use is reported and
 * skipped rather than replacing a colour with something Ink will not render -
 * `text.primary: "bold white"` should not blank the transcript.
 *
 * The shape is checked here rather than with a schema library because the set is
 * small and flat: the same walk that validates it produces the overrides.
 */
export interface ThemeFile {
  overrides: Record<string, Record<string, string> | string>;
  /** Paths the file set that the palette does not have, or whose value is unusable. */
  rejected: string[];
}

const GROUPS = ["text", "status", "border", "syntax", "tool", "diff"] as const;

export function readThemeOverrides(value: unknown): ThemeFile {
  const rejected: string[] = [];
  const overrides: Record<string, Record<string, string> | string> = {};
  if (!isRecord(value)) {
    return { overrides, rejected: ["(root)"] };
  }

  for (const [key, entry] of Object.entries(value)) {
    if (GROUPS.includes(key as (typeof GROUPS)[number])) {
      if (!isRecord(entry)) {
        rejected.push(key);
        continue;
      }
      const group: Record<string, string> = {};
      for (const [token, colour] of Object.entries(entry)) {
        if (typeof colour === "string" && colour.trim() !== "") {
          group[token] = colour;
        } else {
          rejected.push(`${key}.${token}`);
        }
      }
      if (Object.keys(group).length > 0) {
        overrides[key] = group;
      }
      continue;
    }
    if ((key === "accent" || key === "user") && typeof entry === "string") {
      overrides[key] = entry;
      continue;
    }
    rejected.push(key);
  }
  return { overrides, rejected };
}

/** Deep-merges the accepted overrides onto the base palette. */
export function mergeTheme(
  base: Theme,
  overrides: ThemeFile["overrides"],
): Theme {
  const merged = structuredClone(base) as unknown as Record<
    string,
    Record<string, string> | string
  >;
  for (const [key, entry] of Object.entries(overrides)) {
    if (typeof entry === "string") {
      merged[key] = entry;
    } else {
      merged[key] = { ...(merged[key] as Record<string, string>), ...entry };
    }
  }
  return merged as unknown as Theme;
}

/** Reads one theme file; a file that is not JSON is reported, not thrown. */
export function readThemeFile(file: string): {
  overrides?: ThemeFile["overrides"];
  rejected: string[];
  problem?: string;
} {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return { rejected: [], problem: `no theme file at ${file}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      rejected: [],
      problem: `${file} is not JSON: ${(error as Error).message}`,
    };
  }
  const { overrides, rejected } = readThemeOverrides(parsed);
  return { overrides, rejected };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
