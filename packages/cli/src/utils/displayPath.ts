/**
 * One spelling for a path the model or the user reads.
 *
 * `path.relative` and the language servers hand back `\home\lin\.tnt` on Windows,
 * which then appears inside tool results and confirmation messages: two answers
 * about the same file differ by separator, an assertion written on one platform
 * fails on another, and the model quotes back something it cannot paste into a
 * POSIX shell. Forward slashes are what every other path in the transcript uses
 * and what the tools accept on all three systems, so the fold happens once, here,
 * at the boundary where a path becomes text.
 *
 * Filesystem calls must keep using the platform spelling - this is for display
 * strings, not for `open()`.
 */
export function toDisplayPath(value: string): string {
  // Both separators, not just `path.sep`: a language server can answer with a
  // Windows path on any box, and folding only the host's own separator would
  // leave that one unconverted - and untestable off Windows.
  return value.split(/[/\\]/).join("/");
}
