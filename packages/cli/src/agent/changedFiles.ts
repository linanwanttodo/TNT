import { changedFilesSinceSeen } from "../tools/fileState.js";

/**
 * How many paths one note names. The point is the warning, not the inventory,
 * and a long list of paths costs tokens on every turn the model did not ask for.
 */
const MAX_NAMED_PATHS = 8;

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

  return [
    "<system-reminder>",
    `Files you read earlier changed on disk since you read them: ${paths.join(
      ", ",
    )}${rest > 0 ? ` (and ${rest} more)` : ""}.`,
    "Read a file again before editing it: the write tools refuse a change to a file that moved since it was read.",
    "</system-reminder>",
  ].join(" ");
}
