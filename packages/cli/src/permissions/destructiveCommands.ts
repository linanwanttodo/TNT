import * as os from "os";
import * as path from "path";

import { commandSegments } from "./bashCommandRule.js";
import { isWithinWorkspace, workspaceRoot } from "./workspacePath.js";

/**
 * The message the model reads when a destructive command meets an allow rule or
 * a session approval. Neither one answers for this call: the user approved the
 * tool or an earlier shape, not this history rewrite or this deletion.
 */
export const DESTRUCTIVE_COMMAND_NOTICE =
  "This command destroys history or files the request did not name, so an allow rule or a session approval cannot answer for it. Approve this call to run it.";

function stripQuotes(word: string): string {
  return word.replace(/^["']|["']$/g, "");
}

/** A short flag bundle such as `-fd` or `-rf` contains the named letter. */
function shortFlagHas(word: string, letter: string): boolean {
  return (
    word.startsWith("-") &&
    !word.startsWith("--") &&
    word.length > 1 &&
    word.slice(1).includes(letter)
  );
}

/**
 * The subcommand, skipping the global options git accepts before it. `-C` and
 * `-c` take a value, so the value must not be read as the subcommand.
 */
function gitSubcommand(
  words: readonly string[],
): { subcommand: string; rest: string[] } | undefined {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (
      word === "-C" ||
      word === "-c" ||
      word === "--git-dir" ||
      word === "--work-tree" ||
      word === "--namespace" ||
      word === "--exec-path"
    ) {
      index += 2;
      continue;
    }
    if (word.startsWith("-")) {
      index += 1;
      continue;
    }
    return { subcommand: word, rest: words.slice(index + 1) };
  }
  return undefined;
}

/**
 * `git` subcommands that destroy working-tree state or rewrite history. Each is
 * matched on the form that actually destroys: `git branch -d` is a normal
 * delete after a merge, while `-D` throws the branch away unmerged.
 */
function isDestructiveGit(words: readonly string[]): boolean {
  const parsed = gitSubcommand(words);
  if (!parsed) return false;
  const { subcommand, rest } = parsed;

  switch (subcommand) {
    case "reset":
      return rest.some((arg) => arg === "--hard");
    case "clean":
      if (rest.some((arg) => arg === "--dry-run" || shortFlagHas(arg, "n"))) {
        return false;
      }
      return rest.some((arg) => arg === "--force" || shortFlagHas(arg, "f"));
    case "checkout":
      // `git checkout -- <path>` and `git checkout HEAD -- <path>` discard the
      // working tree; a branch switch does not.
      if (rest.includes("--")) return true;
      if (rest.some((arg) => arg === "-f" || arg === "--force")) return true;
      return rest.some(
        (arg) => !arg.startsWith("-") && stripQuotes(arg) === ".",
      );
    case "restore": {
      // Without `--staged` this restores from the index and discards the
      // working tree. `git restore --staged` only unstages.
      const stagedOnly = rest.some((arg) => arg === "--staged" || arg === "-S");
      const worktree = rest.some((arg) => arg === "--worktree" || arg === "-W");
      return worktree || !stagedOnly;
    }
    case "branch":
      return rest.some((arg) => arg === "-D");
    case "stash":
      return rest[0] === "drop" || rest[0] === "clear";
    case "push":
      return rest.some(
        (arg) =>
          arg === "-f" ||
          arg === "--force" ||
          arg === "--force-with-lease" ||
          arg.startsWith("--force-with-lease="),
      );
    case "filter-branch":
      return true;
    case "reflog":
      return rest[0] === "expire";
    case "gc":
      return rest.some((arg) => arg === "--prune" || arg === "--prune=now");
    default:
      return false;
  }
}

function expandHome(target: string): string {
  if (target === "~") return os.homedir();
  if (target.startsWith("~/")) return path.join(os.homedir(), target.slice(2));
  return target;
}

/**
 * `rm` destroys without a recovery path, so a recursive forced removal is
 * escalated when any target cannot be shown to be inside the workspace. A
 * removal of a build directory inside the workspace stays an ordinary call.
 * A target the shell will expand is treated as outside: the gate cannot prove
 * where it lands, and naming no destination is not the same as staying inside.
 */
function isDestructiveRm(args: readonly string[]): boolean {
  let recursive = false;
  let force = false;
  const targets: string[] = [];

  for (const raw of args) {
    if (raw === "--") continue;
    if (raw.startsWith("--")) {
      if (raw === "--recursive") recursive = true;
      if (raw === "--force") force = true;
      continue;
    }
    if (raw.startsWith("-") && raw.length > 1) {
      if (shortFlagHas(raw, "r") || shortFlagHas(raw, "R")) recursive = true;
      if (shortFlagHas(raw, "f")) force = true;
      continue;
    }
    targets.push(stripQuotes(raw));
  }

  if (!recursive || !force || targets.length === 0) return false;

  return targets.some((target) => {
    if (/^\$[{A-Za-z_]/.test(target)) return true;
    const resolved = path.resolve(process.cwd(), expandHome(target));
    return resolved === workspaceRoot() || !isWithinWorkspace(resolved);
  });
}

function segmentIsDestructive(segment: string): boolean {
  const words = segment
    .trim()
    .split(/[\s\t]+/)
    .filter(Boolean);

  let index = 0;
  while (
    index < words.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
  ) {
    index += 1;
  }
  if (index >= words.length) return false;

  const program = path
    .basename(stripQuotes(words[index]))
    .replace(/\.exe$/i, "")
    .toLowerCase();
  const args = words.slice(index + 1);

  if (program === "git") return isDestructiveGit(args);
  if (program === "rm") return isDestructiveRm(args);
  return false;
}

/**
 * True when any command in the call destroys history or working-tree state in
 * a way an allow rule cannot answer for. The call is judged segment by
 * segment, so `ls && git reset --hard` is not covered by a rule that matched
 * only `ls`.
 */
export function isDestructiveCommand(command: unknown): boolean {
  if (typeof command !== "string" || command.trim() === "") return false;
  return commandSegments(command).some(segmentIsDestructive);
}

/** The tool-aware spelling used by the approval cache and the policy gate. */
export function isDestructiveCall(
  toolName: string,
  toolArgs: unknown,
): boolean {
  if (toolName !== "Bash") return false;
  const args =
    typeof toolArgs === "object" && toolArgs !== null
      ? (toolArgs as Record<string, unknown>)
      : {};
  return isDestructiveCommand(args.command);
}
