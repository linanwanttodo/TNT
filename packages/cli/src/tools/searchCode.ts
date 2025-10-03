import * as child_process from "child_process";
import * as fs from "fs";
import * as util from "util";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { findUp } from "find-up";

import { parseEnvNumber } from "../utils/truncateOutput.js";

import { Tool } from "./types.js";

const execFilePromise = util.promisify(child_process.execFile);

/**
 * No shell here: the pattern, the path and each .gitignore line stay data
 * (ARCHITECTURE-tnt.md section 2).
 */
async function search(
  program: string,
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFilePromise(program, args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function getGitignorePatterns() {
  const gitIgnorePath = await findUp(".gitignore");
  if (!gitIgnorePath) return [];
  const content = fs.readFileSync(gitIgnorePath, "utf-8");
  const ignorePatterns = [];
  for (let line of content.trim().split("\n")) {
    line = line.trim();
    if (line.startsWith("#") || line === "") continue; // ignore comments and empty line
    if (line.startsWith("!")) continue; // ignore negated ignores
    ignorePatterns.push(line);
  }
  return ignorePatterns;
}

// procedure 1: search with ripgrep
//
// The answer cannot change while a process is running, but the tool list is
// rebuilt on every turn, so probing it per turn would spawn a subprocess each
// time. The result is cached for the life of the process.
let ripgrepProbe: Promise<boolean> | undefined;

export async function checkIfRipgrepIsInstalled(): Promise<boolean> {
  ripgrepProbe ??= (async () => {
    try {
      await search("rg", ["--version"]);
      return true;
    } catch {
      return false;
    }
  })();
  return ripgrepProbe;
}

/** Clears the cached probe so a test can force a different answer. */
export function resetRipgrepProbeCache(): void {
  ripgrepProbe = undefined;
}

async function searchWithRipgrep(
  pattern: string,
  searchPath: string,
  filePattern?: string,
) {
  const args = ["--line-number", "--with-filename", "--color", "never"];

  if (filePattern) {
    args.push("--glob", filePattern);
  }

  const ignorePatterns = await getGitignorePatterns();
  for (const ignorePattern of ignorePatterns) {
    args.push("--glob", `!${ignorePattern}`);
  }

  args.push("--", pattern, searchPath);
  return await search("rg", args);
}

// procedure 2: search with grep on unix or findstr on windows
async function searchWithGrepOrFindstr(
  pattern: string,
  searchPath: string,
  filePattern?: string,
) {
  const isWindows = process.platform === "win32";
  const ignorePatterns = await getGitignorePatterns();
  if (isWindows) {
    // findstr has no way to exclude paths, so the ignore list is not used here.
    const fileSpec = filePattern ? filePattern : "*";
    return await search(
      "findstr",
      ["/S", "/N", "/P", "/R", pattern, fileSpec],
      searchPath,
    );
  }
  const args = ["-R", "-n", "-H", "-I"];
  for (const ignorePattern of ignorePatterns) {
    // use both exclude and exclude-dir because ignorePattern can be a file or directory
    args.push(`--exclude=${ignorePattern}`, `--exclude-dir=${ignorePattern}`);
  }
  // --include matches file names, not whole paths: the path-shaped form the
  // shell pipeline used needs a second program fed by a pipe.
  if (filePattern) {
    args.push(`--include=${filePattern}`);
  }
  args.push("--", pattern, ".");
  return await search("grep", args, searchPath);
}

// Output truncation defaults
const DEFAULT_SEARCH_MAX_RESULTS = 100;
const DEFAULT_SEARCH_MAX_RESULT_CHARS = 1000; // Max chars per result line
/** A caller may ask for fewer lines; asking for more than this is not honoured. */
const MAX_SEARCH_HEAD_LIMIT = 500;

function getSearchMaxResults(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_SEARCH_CODE_MAX_RESULTS,
    DEFAULT_SEARCH_MAX_RESULTS,
  );
}

function resolveMaxResults(requested: unknown): number {
  const value = Number(requested);
  if (!Number.isFinite(value) || value <= 0) return getSearchMaxResults();
  return Math.min(Math.floor(value), MAX_SEARCH_HEAD_LIMIT);
}

function getSearchMaxResultChars(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_SEARCH_CODE_MAX_RESULT_CHARS,
    DEFAULT_SEARCH_MAX_RESULT_CHARS,
  );
}

export const searchCodeTool: Tool = {
  name: "Search",
  displayName: "Search",
  description: `Search the codebase using ripgrep (rg) for a specific pattern.
Returns at most ${DEFAULT_SEARCH_MAX_RESULTS} lines by default, overridable with head_limit, and drops any match line longer than ${DEFAULT_SEARCH_MAX_RESULT_CHARS} characters - when it drops something, the result says so rather than claiming there were no matches. It searches the content of files, not their names: file names in one directory come from List, and a name lookup across the tree from Bash.`,
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "The search pattern to look for",
      },
      path: {
        type: "string",
        description: "The path to search in (defaults to current directory)",
      },
      file_pattern: {
        type: "string",
        description: "Optional file pattern to filter results (e.g., '*.ts')",
      },
      head_limit: {
        type: "number",
        description: `Maximum number of result lines to return (default ${DEFAULT_SEARCH_MAX_RESULTS}, ceiling ${MAX_SEARCH_HEAD_LIMIT})`,
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    const truncatedPattern =
      args.pattern.length > 50
        ? args.pattern.substring(0, 50) + "..."
        : args.pattern;
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will search for: "${truncatedPattern}"`,
        },
      ],
    };
  },
  run: async (args: {
    pattern: string;
    path?: string;
    file_pattern?: string;
    head_limit?: number;
  }): Promise<string> => {
    const searchPath = args.path || process.cwd();
    if (!fs.existsSync(searchPath)) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `Path does not exist: ${searchPath}`,
      );
    }

    let stdout = "",
      stderr = "";
    try {
      if (await checkIfRipgrepIsInstalled()) {
        const results = await searchWithRipgrep(
          args.pattern,
          searchPath,
          args.file_pattern,
        );
        stdout = results.stdout;
        stderr = results.stderr;
      } else {
        const results = await searchWithGrepOrFindstr(
          args.pattern,
          searchPath,
          args.file_pattern,
        );
        stdout = results.stdout;
        stderr = results.stderr;
      }

      if (stderr) {
        return `Warning during search: ${stderr}\n\n${stdout}`;
      }

      if (!stdout.trim()) {
        return `No matches found for pattern "${args.pattern}"${
          args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
        }.`;
      }

      // Split the results into lines and limit the number of results
      const maxResults = resolveMaxResults(args.head_limit);
      const maxResultChars = getSearchMaxResultChars();

      const matchLines = stdout.split("\n").filter((line) => line.length > 0);
      const lines = matchLines.filter((line) => line.length <= maxResultChars);
      const droppedLongLines = matchLines.length - lines.length;

      if (lines.length === 0) {
        // Matches existed and every one of them was too long to show. Answering
        // "no matches" here tells the model its pattern was wrong, and it goes
        // and re-searches for something that was found the first time.
        return `Matches found for pattern "${args.pattern}"${
          args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
        }, but all ${droppedLongLines} line(s) are longer than the ${maxResultChars}-character limit. Narrow the pattern or search a smaller path.`;
      }

      const truncated = lines.length > maxResults;
      const limitedLines = lines.slice(0, maxResults);
      const resultText = limitedLines.join("\n");

      const notes: string[] = [];
      if (truncated) {
        notes.push(`showing ${maxResults} of ${lines.length} matches`);
      }
      if (droppedLongLines > 0) {
        notes.push(
          `${droppedLongLines} match line(s) over ${maxResultChars} characters were not shown`,
        );
      }
      const truncationMessage =
        notes.length > 0 ? `\n\n[Results truncated: ${notes.join("; ")}]` : "";

      return `Search results for pattern "${args.pattern}"${
        args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
      }:\n\n${resultText}${truncationMessage}`;
    } catch (error: any) {
      if (error instanceof ContinueError) {
        throw error;
      }
      if (error.code === 1) {
        return `No matches found for pattern "${args.pattern}"${
          args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
        }.`;
      }
      throw new Error(
        `Error executing search: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
