import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import util from "util";

import { formatToolArgument } from "./formatters.js";
import { checkIfRipgrepIsInstalled } from "./searchCode.js";
import { Tool } from "./types.js";

const execFilePromise = util.promisify(execFile);

/** How many paths one answer carries; the rest are named as missing. */
const DEFAULT_GLOB_MAX_RESULTS = 1000;

function maxResults(): number {
  const configured = Number(process.env.CONTINUE_CLI_GLOB_MAX_RESULTS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_GLOB_MAX_RESULTS;
  }

  return Math.floor(configured);
}

function modifiedAgo(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    // A file that vanished mid-walk has no age, so it falls to the end rather
    // than failing the whole listing.
    return -1;
  }
}

/**
 * Find files by name, at any depth, without a shell.
 *
 * `List` walks one directory and `Search` reads file contents, so a lookup by
 * name across the tree had neither tool to use. This one is ripgrep's
 * `--files`, which also means the answer is already filtered by what the
 * repository ignores - the same set of files the user's editor shows.
 */
export const globFilesTool: Tool = {
  name: "Glob",
  displayName: "Glob",
  description: `Find files by name pattern at any depth, newest modified first, using ripgrep's file listing: it honours .gitignore and never reads file contents. Returns at most ${DEFAULT_GLOB_MAX_RESULTS} paths and says so when it stops - an empty answer means nothing matched, not that the tool gave up. For text inside files use Search; for one directory's entries use List.`,
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description:
          "File name pattern to match, e.g. '**/*.ts' or 'src/**/*.test.tsx'",
      },
      path: {
        type: "string",
        description:
          "Directory to search under (defaults to the current working directory)",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    const pattern =
      typeof args?.pattern === "string" ? args.pattern.trim() : "";
    if (!pattern) {
      throw new Error(
        "Glob needs a pattern: an empty pattern would list the whole tree.",
      );
    }

    return {
      args: { pattern, path: args?.path },
      preview: [
        {
          type: "text",
          content: `Will find files matching ${formatToolArgument(pattern)}`,
        },
      ],
    };
  },
  run: async (args: { pattern: string; path?: string }): Promise<string> => {
    const pattern = (args.pattern ?? "").trim();
    if (!pattern) {
      throw new Error(
        "Glob needs a pattern: an empty pattern would list the whole tree.",
      );
    }

    if (!(await checkIfRipgrepIsInstalled())) {
      // Falling back to a hand-rolled walk would answer with a different set of
      // files than the repository's own ignore rules describe, so it says what
      // is missing instead. List works without ripgrep.
      throw new Error(
        "Glob lists files with ripgrep (rg), which is not installed. Use List for one directory, or install rg.",
      );
    }

    const root = args.path ? path.resolve(args.path) : process.cwd();
    const limit = maxResults();

    let listed: string;
    try {
      const { stdout } = await execFilePromise(
        "rg",
        ["--files", "--glob", pattern, root],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      listed = stdout;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      if (failure.code !== 1 || (failure.stdout ?? "").trim()) {
        throw error;
      }
      listed = "";
    }

    const files = listed.split("\n").filter(Boolean);
    files.sort((a, b) => modifiedAgo(b) - modifiedAgo(a) || (a < b ? -1 : 1));

    const kept = files.slice(0, limit);
    const lines = kept.join("\n");

    if (files.length > limit) {
      const rest = files.length - limit;
      return `${lines}\n(${rest} more ${rest === 1 ? "file" : "files"} not listed - narrow the pattern or search under a smaller path)`;
    }

    return lines || `No files match the pattern "${pattern}".`;
  },
};
