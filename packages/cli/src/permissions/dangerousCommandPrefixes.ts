import { commandSegments } from "./bashCommandRule.js";

/**
 * A leading word that makes an allow rule unable to answer for the call: an
 * interpreter, a package runner, a shell, or a wrapper that runs what it is
 * given. An allow rule for such a prefix approves arbitrary code, because the
 * prefix decides nothing about what runs next, so a match is narrowed back to
 * an ask instead of returned as an allow.
 *
 * Two-word entries are matched by leading words, so `npm run` is told apart
 * from `npm install`, and `su` does not match `sudo`. The list follows this
 * CLI's own surface: the shells, runners and remote tools a session reaches
 * through the terminal tool.
 */
export const DANGEROUS_ALLOW_PREFIXES: readonly (readonly string[])[] = [
  // Interpreters
  ["python"],
  ["python2"],
  ["python3"],
  ["node"],
  ["nodejs"],
  ["deno"],
  ["bun"],
  ["tsx"],
  ["ts-node"],
  ["ruby"],
  ["perl"],
  ["php"],
  ["lua"],
  ["Rscript"],

  // Package runners: the script name, not the package manager, decides what runs
  ["npx"],
  ["bunx"],
  ["pnpm", "dlx"],
  ["yarn", "dlx"],
  ["pipx", "run"],
  ["uvx"],
  ["npm", "run"],
  ["pnpm", "run"],
  ["yarn", "run"],
  ["bun", "run"],

  // Shells and wrappers that execute their arguments
  ["bash"],
  ["sh"],
  ["zsh"],
  ["fish"],
  ["dash"],
  ["ksh"],
  ["csh"],
  ["tcsh"],
  ["powershell"],
  ["pwsh"],
  ["cmd"],
  ["eval"],
  ["exec"],
  ["env"],
  ["xargs"],
  ["command"],
  ["nohup"],
  ["timeout"],
  ["watch"],
  ["script"],
  ["busybox"],

  // Remote, privilege, and download-and-run entry points
  ["ssh"],
  ["scp"],
  ["sftp"],
  ["rsync"],
  ["sudo"],
  ["su"],
  ["doas"],
  ["pkexec"],
  ["runas"],
  ["curl"],
  ["wget"],
  ["nc"],
  ["netcat"],
];

/**
 * The leading words of a segment, with environment assignments and any
 * directory prefix removed. A quoted program name is unwrapped and a `.exe`
 * suffix is dropped, so the same entry covers `/usr/bin/python3`, `"python3"`
 * and a Windows spelling of the interpreter.
 */
function leadingWords(segment: string): string[] {
  const words = segment.trim().split(/[\s\t]+/);
  let index = 0;
  while (
    index < words.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
  ) {
    index += 1;
  }
  if (index >= words.length) {
    return [];
  }

  const parts = words[index].split(/[\\/]/);
  const program = (parts[parts.length - 1] ?? words[index])
    .replace(/^["']|["']$/g, "")
    .replace(/\.exe$/i, "");
  return [program, ...words.slice(index + 1)];
}

function isDangerousPrefix(words: string[]): boolean {
  return DANGEROUS_ALLOW_PREFIXES.some((prefix) =>
    prefix.every((word, index) => words[index] === word),
  );
}

/**
 * True when any command in the call starts with a word that can run arbitrary
 * code. A chain is judged segment by segment, so `ls && python3 x.py` is not
 * covered by a rule that matched only `ls`.
 */
export function hasDangerousAllowPrefix(command: unknown): boolean {
  if (typeof command !== "string") {
    return false;
  }

  return commandSegments(command).some((segment) => {
    const words = leadingWords(segment);
    return words.length > 0 && isDangerousPrefix(words);
  });
}
