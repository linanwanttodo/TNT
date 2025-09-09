import * as fs from "fs";

import { throwIfFileIsSecurityConcern } from "core/indexing/ignore.js";
import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

import { parseEnvNumber } from "../utils/truncateOutput.js";

import { formatToolArgument } from "./formatters.js";
import { markFileAsSeen } from "./fileState.js";
import { Tool, ToolRunContext } from "./types.js";

// Output truncation defaults
const DEFAULT_READ_FILE_MAX_CHARS = 100000; // ~25k tokens
const DEFAULT_READ_FILE_MAX_LINES = 5000;

function getReadFileMaxChars(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_READ_FILE_MAX_OUTPUT_CHARS,
    DEFAULT_READ_FILE_MAX_CHARS,
  );
}

function getReadFileMaxLines(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_READ_FILE_MAX_OUTPUT_LINES,
    DEFAULT_READ_FILE_MAX_LINES,
  );
}

/**
 * The section a call asked for, clamped to the file. One-sided input is refused
 * by asking for both ends: half a range would read to the end of the file, which
 * is the oversized answer the range exists to avoid.
 */
export function readRange(
  args: { start_line?: number; end_line?: number },
  lineCount: number,
): { start: number; end: number } | null {
  const start = Number(args.start_line);
  const end = Number(args.end_line);
  if (!Number.isFinite(start) && !Number.isFinite(end)) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "start_line and end_line must both be given, with end_line at or after start_line",
    );
  }
  if (start < 1) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "start_line counts from 1",
    );
  }
  if (start > lineCount) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `start_line ${start} is past the end of a ${lineCount}-line file`,
    );
  }
  return {
    start: Math.floor(start),
    end: Math.min(Math.floor(end), lineCount),
  };
}

// Read state is tracked with what the file looked like at the time, so a write
// can tell an unchanged file from one edited outside TNT. See fileState.ts.

export const readFileTool: Tool = {
  name: "Read",
  displayName: "Read",
  description: `Read the contents of a file at the specified path.
One call returns at most ${DEFAULT_READ_FILE_MAX_LINES} lines or ${DEFAULT_READ_FILE_MAX_CHARS} characters; a larger file is refused rather than cut, so pass start_line and end_line to read the section you need instead of guessing at the whole file.`,
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "The path to the file to read",
      },
      start_line: {
        type: "number",
        description: `First line of the section to read, counting from 1 (requires end_line)`,
      },
      end_line: {
        type: "number",
        description: "Last line of the section to read, inclusive",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    let { filepath } = args;
    if (filepath.startsWith("./")) {
      filepath = filepath.slice(2);
    }
    throwIfFileIsSecurityConcern(filepath);
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will read ${formatToolArgument(filepath)}`,
        },
      ],
    };
  },
  run: async (
    args: { filepath: string; start_line?: number; end_line?: number },
    context?: ToolRunContext,
  ): Promise<string> => {
    try {
      let { filepath } = args;
      if (filepath.startsWith("./")) {
        filepath = filepath.slice(2);
      }

      if (!fs.existsSync(filepath)) {
        throw new ContinueError(
          ContinueErrorReason.Unspecified,
          `File does not exist: ${filepath}`,
        );
      }
      const realPath = fs.realpathSync(filepath);
      const content = fs.readFileSync(realPath, "utf-8");

      // Divide limits by parallel tool call count to avoid context overflow
      const parallelCount = context?.parallelToolCallCount ?? 1;
      const baseMaxLines = getReadFileMaxLines();
      const baseMaxChars = getReadFileMaxChars();
      const maxLines = Math.floor(baseMaxLines / parallelCount);
      const maxChars = Math.floor(baseMaxChars / parallelCount);
      const allLines = content.split("\n");
      const lineCount = allLines.length;
      const charCount = content.length;

      const range = readRange(args, lineCount);
      if (range) {
        const section = allLines.slice(range.start - 1, range.end);
        // The stamp is the whole file: the edit guard asks whether the file moved
        // since it was read, which a section read answers as well as all of it.
        markFileAsSeen(realPath);
        return `Content of ${filepath} (lines ${range.start}-${range.end} of ${lineCount}):\n${section.join("\n")}`;
      }

      if (charCount > maxChars || lineCount > maxLines) {
        // Include note about single-tool limit when parallel calls reduce the limit
        const parallelNote =
          parallelCount > 1
            ? ` (Note: limit reduced due to ${parallelCount} parallel tool calls. Single-tool limit: ${baseMaxChars.toLocaleString()} characters or ${baseMaxLines.toLocaleString()} lines.)`
            : "";

        throw new ContinueError(
          ContinueErrorReason.FileTooLarge,
          `File is too large to read: ${filepath} (${charCount.toLocaleString()} characters, ${lineCount.toLocaleString()} lines). ` +
            `Maximum allowed: ${maxChars.toLocaleString()} characters or ${maxLines.toLocaleString()} lines.${parallelNote} ` +
            `Read a section with start_line and end_line, or search within it with Search, instead of shell commands.`,
        );
      }

      // Remember the file and its stamp on disk for the edit tools
      markFileAsSeen(realPath);

      return `Content of ${filepath}:\n${content}`;
    } catch (error) {
      if (error instanceof ContinueError) {
        throw error;
      }
      throw new Error(
        `Error reading file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
