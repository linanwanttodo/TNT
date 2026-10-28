import * as fs from "fs";
import * as path from "path";

import { throwIfFileIsSecurityConcern } from "core/indexing/ignore.js";
import { TntError, TntErrorReason } from "core/util/errors.js";

import { parseEnvNumber } from "../utils/truncateOutput.js";

import { markFileAsSeen } from "./fileState.js";
import { formatToolArgument } from "./formatters.js";
import { Tool, ToolResult, ToolRunContext } from "./types.js";
import {
  isWorkspaceFileServiceActive,
  readWorkspaceTextFile,
} from "./workspaceFiles.js";

// Output truncation defaults
const DEFAULT_READ_FILE_MAX_CHARS = 100000; // ~25k tokens
const DEFAULT_READ_FILE_MAX_LINES = 5000;

function getReadFileMaxChars(): number {
  return parseEnvNumber(
    process.env.TNT_READ_FILE_MAX_OUTPUT_CHARS,
    DEFAULT_READ_FILE_MAX_CHARS,
  );
}

function getReadFileMaxLines(): number {
  return parseEnvNumber(
    process.env.TNT_READ_FILE_MAX_OUTPUT_LINES,
    DEFAULT_READ_FILE_MAX_LINES,
  );
}

/**
 * Every returned line carries its own number, because a citation the user cannot
 * check is not evidence: `path:line` asks the reader to open that line, and an
 * unnumbered dump makes that a guess.
 */
/**
 * Costs `digits(n) + 1` bytes per line: measured on a 2000-line file, +9.57%
 * (92,889 -> 101,782 bytes). The refusal below is still judged on the raw content
 * so no file that used to be readable becomes refused; instead the numbered text
 * is trimmed to the same character cap, which is what sends a saturated read
 * roughly that 9.6% shorter than it would otherwise be.
 */
function numberLines(lines: string[], firstLine: number): string {
  return lines.map((line, i) => `${firstLine + i}\t${line}`).join("\n");
}

/**
 * The lines whose numbered rendering fits `maxChars` once the header named by
 * `headerFor` is counted too - the cap applied to what is actually sent, not to
 * what was on disk. Lines go from the tail, so the section a caller asked for is
 * answered from its beginning.
 *
 * The last line is never dropped: one numbered line longer than the cap is what
 * the raw-content refusal above is for, and an empty answer would read as an
 * empty file.
 */
function fitNumberedLines(options: {
  lines: string[];
  firstLine: number;
  maxChars: number;
  headerFor: (lastShown: number) => string;
}): string[] {
  const { lines, firstLine, maxChars, headerFor } = options;
  const sizes = lines.map(
    (line, index) =>
      String(firstLine + index).length + 1 /* the tab */ + line.length,
  );

  let kept = lines.length;
  let bodyLength =
    sizes.reduce((total, size) => total + size, 0) + Math.max(0, kept - 1);

  while (
    kept > 1 &&
    headerFor(firstLine + kept - 1).length + bodyLength > maxChars
  ) {
    bodyLength -= sizes[kept - 1] + 1;
    kept--;
  }

  return lines.slice(0, kept);
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
    throw new TntError(
      TntErrorReason.Unspecified,
      "start_line and end_line must both be given, with end_line at or after start_line",
    );
  }
  if (start < 1) {
    throw new TntError(TntErrorReason.Unspecified, "start_line counts from 1");
  }
  if (start > lineCount) {
    throw new TntError(
      TntErrorReason.Unspecified,
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

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Base64 grows by a third; 3 MB of bytes stays under the inline request cap. */
const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Images are perception, not text: return their bytes so the host can attach
 * them to the conversation. The text limits below do not apply, and a file too
 * large for one request is refused with the size rather than cut.
 */
function imageResult(filepath: string): ToolResult | string | undefined {
  const mimeType =
    IMAGE_MIME_BY_EXTENSION[path.extname(filepath).toLowerCase()];
  if (!mimeType) return undefined;
  let size: number;
  try {
    size = fs.statSync(filepath).size;
  } catch {
    return undefined;
  }
  if (size > MAX_INLINE_IMAGE_BYTES) {
    return `Image is too large to read inline: ${filepath} (${(
      size /
      (1024 * 1024)
    ).toFixed(1)} MB). The limit is 3 MB; crop or resize it first.`;
  }
  try {
    const data = fs.readFileSync(filepath);
    return {
      content: `Read ${filepath} (${mimeType}, ${data.length} bytes).`,
      images: [{ mimeType, data: data.toString("base64") }],
    };
  } catch {
    return undefined;
  }
}

export const readFileTool: Tool = {
  name: "Read",
  displayName: "Read",
  description: `Read the contents of a file at the specified path.
One call returns at most ${DEFAULT_READ_FILE_MAX_LINES} lines or ${DEFAULT_READ_FILE_MAX_CHARS} characters; a larger file is refused rather than cut, so pass start_line and end_line to read the section you need instead of guessing at the whole file.
Image files (png, jpg, jpeg, webp, gif) are returned as image content so a vision model can look at them; start_line and end_line apply to text only.
Do not read a file back just to confirm an edit landed: the edit would have failed if it did not apply, and the file's state is tracked for you.`,
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
  ): Promise<ToolResult | string> => {
    try {
      let { filepath } = args;
      if (filepath.startsWith("./")) {
        filepath = filepath.slice(2);
      }

      // Also enforced here, not only in `preprocess`: `preprocess` has one caller
      // (`stream/streamChatResponse.helpers.ts`) and shell mode already calls a tool's
      // `run()` directly, so the check cannot be load-bearing where it was.
      throwIfFileIsSecurityConcern(filepath);

      const image = imageResult(filepath);
      if (image) {
        return image;
      }

      if (!isWorkspaceFileServiceActive() && !fs.existsSync(filepath)) {
        throw new TntError(
          TntErrorReason.Unspecified,
          `File does not exist: ${filepath}`,
        );
      }
      let read: Awaited<ReturnType<typeof readWorkspaceTextFile>>;
      try {
        read = await readWorkspaceTextFile(filepath);
      } catch (error) {
        if (!isWorkspaceFileServiceActive() && !fs.existsSync(filepath)) {
          throw new TntError(
            TntErrorReason.Unspecified,
            `File does not exist: ${filepath}`,
          );
        }
        throw error;
      }
      const realPath = read.realPath;
      const content = read.content;

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
        const headerFor = (lastShown: number) =>
          `Content of ${filepath} (lines ${range.start}-${lastShown} of ${lineCount}):`;
        const kept = fitNumberedLines({
          lines: section,
          firstLine: range.start,
          maxChars,
          headerFor,
        });
        // The stamp is the whole file: the edit guard asks whether the file moved
        // since it was read, which a section read answers as well as all of it.
        markFileAsSeen(realPath);
        return `${headerFor(range.start + kept.length - 1)}\n${numberLines(
          kept,
          range.start,
        )}`;
      }

      if (charCount > maxChars || lineCount > maxLines) {
        // Include note about single-tool limit when parallel calls reduce the limit
        const parallelNote =
          parallelCount > 1
            ? ` (Note: limit reduced due to ${parallelCount} parallel tool calls. Single-tool limit: ${baseMaxChars.toLocaleString()} characters or ${baseMaxLines.toLocaleString()} lines.)`
            : "";

        throw new TntError(
          TntErrorReason.FileTooLarge,
          `File is too large to read: ${filepath} (${charCount.toLocaleString()} characters, ${lineCount.toLocaleString()} lines). ` +
            `Maximum allowed: ${maxChars.toLocaleString()} characters or ${maxLines.toLocaleString()} lines.${parallelNote} ` +
            `Read a section with start_line and end_line, or search within it with Search, instead of shell commands.`,
        );
      }

      // The whole-file header states no bounds, so it stays the plain one unless
      // the numbered body has to give lines back - then the bounds sentence the
      // section read already uses says how much of the file is in the answer.
      const headerFor = (lastShown: number) =>
        lastShown === lineCount
          ? `Content of ${filepath}:`
          : `Content of ${filepath} (lines 1-${lastShown} of ${lineCount}):`;
      const kept = fitNumberedLines({
        lines: allLines,
        firstLine: 1,
        maxChars,
        headerFor,
      });

      // Remember the file and its stamp on disk for the edit tools
      markFileAsSeen(realPath);

      return `${headerFor(kept.length)}\n${numberLines(kept, 1)}`;
    } catch (error) {
      if (error instanceof TntError) {
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
