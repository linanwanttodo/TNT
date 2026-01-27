import * as fs from "fs";

import { changedFilesSinceSeen } from "../tools/fileState.js";

/**
 * How many paths one note names. The point is the warning, not the inventory,
 * and a long list of paths costs tokens on every turn the model did not ask for.
 */
const MAX_NAMED_PATHS = 8;
const MAX_DIFF_LINES = 30;
const MAX_LINES_PER_FILE = 12;
const MAX_CURRENT_BYTES = 64 * 1024;

function currentText(filePath: string): string | undefined {
  try {
    if (fs.statSync(filePath).size > MAX_CURRENT_BYTES) return undefined;
    const content = fs.readFileSync(filePath, "utf-8");
    return content.includes("\u0000") ? undefined : content;
  } catch {
    return undefined;
  }
}

/**
 * A small, bounded line diff for the re-read note. Prefix and suffix are
 * matched so the middle is the change; anything larger than the budget is
 * truncated, because the point is to show what moved, not to replace the read.
 */
function diffLines(
  previous: string | undefined,
  current: string | undefined,
  budget: number,
): string[] {
  if (previous === undefined || current === undefined) return [];
  const before = previous.split("\n");
  const after = current.split("\n");
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  const half = Math.max(1, Math.floor(budget / 2));
  const shown = [
    ...removed.slice(0, half).map((line) => `- ${line}`),
    ...added.slice(0, half).map((line) => `+ ${line}`),
  ];
  if (removed.length + added.length > shown.length) {
    shown.push("  …");
  }
  return shown;
}

/**
 * The turn-level counterpart of the write guard. A file the model read can move
 * under it - an editor, a formatter, a git operation, a background job - and the
 * tools refuse to write such a file, which costs the model a call to find out.
 * Saying it up front lets it re-read first, and it is said once per change.
 */
export function describeChangedFiles(): string | undefined {
  const changed = changedFilesSinceSeen();
  if (changed.length === 0) return undefined;

  const named = changed.slice(0, MAX_NAMED_PATHS);
  const rest = changed.length - named.length;
  const paths = named.map((file) =>
    file.deleted ? `${file.path} (deleted)` : file.path,
  );

  const diff: string[] = [];
  for (const file of named) {
    if (file.deleted || diff.length >= MAX_DIFF_LINES) continue;
    const lines = diffLines(
      file.previous,
      currentText(file.path),
      Math.min(MAX_LINES_PER_FILE, MAX_DIFF_LINES - diff.length),
    );
    if (lines.length === 0) continue;
    diff.push(`${file.path}:`, ...lines);
  }

  return [
    "<system-reminder>",
    `Files you read earlier changed on disk since you read them: ${paths.join(
      ", ",
    )}${rest > 0 ? ` (and ${rest} more)` : ""}.`,
    ...(diff.length > 0 ? ["", ...diff] : []),
    "Read a file again before editing it: the write tools refuse a change to a file that moved since it was read.",
    "</system-reminder>",
  ].join("\n");
}
