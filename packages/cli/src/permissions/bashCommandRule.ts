/**
 * A `Bash(...)` rule grants a shape of command, and the shape has to survive the
 * two ways a single call can hide more than one command: another command after a
 * shell operator, and arbitrary code inside a substitution. Matching the whole
 * command string against the pattern let `Bash(git*)` approve
 * `git add . && rm -rf /`, and `generatePolicyRule` wrote exactly that rule when
 * the user approved such a chain.
 */

/** The operators that end one command and start another. */
const COMMAND_SEPARATOR = /&&|\|\||[;&|\n]/;

/**
 * Code that runs inside a single segment: a substitution, an eval-shaped
 * backtick, or a process substitution. A rule about a command name cannot speak
 * for what these run.
 */
const EMBEDDED_CODE = /\$\(|`|<\(|>\(/;

export function commandSegments(command: string): string[] {
  return command
    .split(COMMAND_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
}

function hasEmbeddedCode(segment: string): boolean {
  return EMBEDDED_CODE.test(segment);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

/**
 * True when the whole command is covered by the rule. A rule without a wildcard
 * names one exact command line, so it is compared as written; a rule with one has
 * to fit every command the call actually runs.
 */
export function bashCommandMatches(command: string, pattern: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || !pattern) return false;

  if (!pattern.includes("*") && !pattern.includes("?")) {
    return trimmed === pattern;
  }

  const segments = commandSegments(trimmed);
  if (segments.length === 0) return false;
  if (segments.some(hasEmbeddedCode)) return false;

  // The form the TUI writes when a run is approved for good: a command name with
  // a trailing star. The star may cover arguments, never another word, so it
  // cannot approve `lsvirtual` under a rule for `ls`.
  const prefixRule = /^([^\s*?]+)\*$/.exec(pattern);
  if (prefixRule) {
    const word = prefixRule[1];
    return segments.every(
      (segment) =>
        segment === word ||
        segment.startsWith(`${word} `) ||
        segment.startsWith(`${word}\t`),
    );
  }

  const regex = globToRegExp(pattern);
  return segments.every((segment) => regex.test(segment));
}
