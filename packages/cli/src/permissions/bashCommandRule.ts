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

/**
 * Commands whose effect is not visible in their name: they remove, they reach
 * another machine, they publish, they run what they fetched, or they rewrite
 * history. A rule about a *shape* cannot answer for them, because the shape is
 * exactly what they vary by - `Bash(git*)` written to approve `git status` would
 * also approve `git push --force`. Only a rule that is the whole line the user
 * read covers these, and the approval prompt writes that form for them.
 */
const NEVER_BY_SHAPE: string[][] = [
  ["rm"],
  ["rmdir"],
  ["dd"],
  ["mkfs"],
  ["shred"],
  ["fdisk"],
  ["parted"],
  ["sudo"],
  ["doas"],
  ["su"],
  ["ssh"],
  ["scp"],
  ["sftp"],
  ["curl"],
  ["wget"],
  ["docker"],
  ["podman"],
  ["kubectl"],
  ["helm"],
  ["terraform"],
  ["aws"],
  ["npm", "publish"],
  ["yarn", "publish"],
  ["pnpm", "publish"],
  ["twine", "upload"],
  ["git", "push"],
  ["git", "reset"],
  ["git", "clean"],
  ["git", "rebase"],
  ["git", "filter-branch"],
];

/**
 * True when a segment is one of those commands. Matching is by leading words, so
 * `su` does not match `sudo` and `git push` is told apart from `git push-config`.
 */
export function isCommandRiskyAlone(segment: string): boolean {
  const words = segment.trim().split(/[\s\t]+/);
  return NEVER_BY_SHAPE.some((entry) =>
    entry.every((word, index) => words[index] === word),
  );
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
  // A shape rule stops here: see NEVER_BY_SHAPE for why these need the exact line.
  if (segments.some(isCommandRiskyAlone)) return false;

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
