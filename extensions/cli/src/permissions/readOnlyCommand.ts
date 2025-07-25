import * as path from "path";

/**
 * Recognizes shell commands that only read.
 *
 * Plan mode promises that the project is not modified, so a command is
 * accepted there only when this module can show it cannot write. The list is
 * deliberately narrow: an unrecognized command is treated as a writer, which
 * costs a denial the model can recover from by asking the user to switch
 * modes, while the opposite mistake would silently edit the working tree.
 *
 * A command that reaches a shell operator is rejected outright. Every operator
 * either writes (`>`, `>>`), pipes into another program, or chains a second
 * command whose own arguments were never inspected, so analyzing the first
 * word would prove nothing about the whole line.
 */

const SHELL_OPERATORS = "<>|;&$`()\n\\";

const READ_ONLY_COMMANDS = new Set([
  "base64",
  "cat",
  "cloc",
  "cut",
  "date",
  "df",
  "diff",
  "du",
  "echo",
  "env",
  "fd",
  "file",
  "find",
  "grep",
  "head",
  "hostname",
  "id",
  "jq",
  "less",
  "ls",
  "md5sum",
  "more",
  "printenv",
  "printf",
  "pwd",
  "rg",
  "sed",
  "sha256sum",
  "sort",
  "stat",
  "tail",
  "tokei",
  "tree",
  "type",
  "uname",
  "uniq",
  "wc",
  "which",
  "whoami",
]);

/** Flags that turn a command whose default behavior reads into a writer. */
const WRITE_FLAGS: Record<string, string[]> = {
  base64: ["-o"],
  find: [
    "-delete",
    "-exec",
    "-execdir",
    "-fls",
    "-fprint",
    "-fprint0",
    "-fprintf",
    "-ok",
    "-okdir",
  ],
  git: ["--output"],
  sed: ["-i", "--in-place"],
  sort: ["-o", "--output"],
};

const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  "blame",
  "cat-file",
  "describe",
  "diff",
  "grep",
  "log",
  "ls-files",
  "ls-remote",
  "name-rev",
  "remote",
  "rev-parse",
  "shortlog",
  "show",
  "show-ref",
  "status",
]);

/** Subcommands whose arguments decide whether they write. */
const GIT_CONDITIONAL_SUBCOMMANDS: Record<string, string[]> = {
  branch: [],
  config: ["--get", "--get-all", "--get-regexp", "-l", "--list"],
  reflog: ["show"],
  stash: ["list", "show"],
  tag: [],
  worktree: ["list"],
};

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const PACKAGE_MANAGER_READ_ONLY_SUBCOMMANDS = new Set([
  "--version",
  "-v",
  "info",
  "list",
  "ls",
  "outdated",
  "view",
  "why",
]);

function hasShellOperator(command: string): boolean {
  let quote: string | null = null;

  for (const character of command) {
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (SHELL_OPERATORS.includes(character)) {
      return true;
    }
  }

  return false;
}

/**
 * A flag that turns a reading command into a writer, matched in the forms a
 * shell accepts: `--output=file`, `-o file`, `-ofile`, and the BSD spelling
 * `-i.bak`.
 */
function hasWriteFlag(program: string, args: readonly string[]): boolean {
  const writeFlags = WRITE_FLAGS[program];
  if (!writeFlags) {
    return false;
  }

  return args.some((arg) =>
    writeFlags.some(
      (flag) =>
        arg === flag ||
        arg.startsWith(`${flag}=`) ||
        (flag.length === 2 && arg.startsWith(flag)),
    ),
  );
}

function isReadOnlyGit(subcommand: string, args: string[]): boolean {
  if (GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return true;
  }

  const conditional = GIT_CONDITIONAL_SUBCOMMANDS[subcommand];
  if (!conditional) {
    return false;
  }

  // `git branch` and `git tag` list when they carry no operand; anything else
  // is a create, rename or delete.
  if (conditional.length === 0) {
    return args.length === 0 || args.every((arg) => arg.startsWith("-"));
  }

  return args.some((arg) => conditional.includes(arg));
}

/**
 * True when the command is known to only read from the working tree.
 */
export function isReadOnlyCommand(command: string | undefined | null): boolean {
  if (typeof command !== "string") {
    return false;
  }

  const trimmed = command.trim();
  if (!trimmed || hasShellOperator(trimmed)) {
    return false;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);

  // Leading assignments only set the environment for this call.
  let index = 0;
  while (
    index < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])
  ) {
    index += 1;
  }
  if (index >= tokens.length) {
    return false;
  }

  const program = path.basename(tokens[index]);
  const args = tokens.slice(index + 1);

  if (hasWriteFlag(program, args)) {
    return false;
  }

  if (program === "git") {
    return args.length > 0 && isReadOnlyGit(args[0], args.slice(1));
  }

  if (PACKAGE_MANAGERS.has(program)) {
    // `npm ls --depth=0` reads; `npm install` and `npm exec` do not. A bare
    // invocation prints the help text, which reads nothing.
    return (
      args.length === 0 || PACKAGE_MANAGER_READ_ONLY_SUBCOMMANDS.has(args[0])
    );
  }

  if (!READ_ONLY_COMMANDS.has(program)) {
    return false;
  }

  return true;
}
