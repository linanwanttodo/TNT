import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { createTwoFilesPatch } from "diff";

import { t } from "../i18n/index.js";
import { scheduleFileRefresh } from "../retrieval/writeRefresh.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import {
  calculateLinesOfCodeDiff,
  getLanguageFromFilePath,
} from "../telemetry/utils.js";

import { changedSinceSeen, markFileAsSeen } from "./fileState.js";
import { readFileTool } from "./readFile.js";
import { MARKER_FILE_CREATED } from "./resultMarkers.js";
import { Tool, ToolCallPreview } from "./types.js";
import {
  isWorkspaceFileServiceActive,
  readWorkspaceTextFileIfExists,
  writeWorkspaceTextFile,
} from "./workspaceFiles.js";

export function generateDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );
}

export const writeFileTool: Tool = {
  name: "Write",
  displayName: "Write",
  description: `Write content to a file at the specified path, replacing the file's whole contents.
To change part of an existing file, prefer Edit: it sends the difference, leaves the rest alone, and refuses the change if the file moved since it was read. To change several files at once, prefer ApplyPatch: one call covers the set and one approval covers the call. Use this for a new file or when every line is being rewritten.`,
  parameters: {
    type: "object",
    required: ["filepath", "content"],
    properties: {
      filepath: {
        type: "string",
        description: "The path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => {
    const filepath = args?.filepath;
    const content = args?.content ?? "";
    if (typeof filepath !== "string") {
      throw new Error(t("tools.filepathMustBeString"));
    }
    if (typeof content !== "string") {
      throw new Error(t("tools.contentMustBeString"));
    }
    try {
      const existing = await readWorkspaceTextFileIfExists(filepath);
      if (existing) {
        const oldContent = existing.content;

        const diff = createTwoFilesPatch(
          args.filepath,
          args.filepath,
          oldContent,
          content,
          undefined,
          undefined,
          { context: 2 },
        );

        return {
          args,
          preview: [
            {
              type: "text",
              content: "Preview of changes:",
            },
            {
              type: "diff",
              content: diff,
            },
          ],
        };
      }
    } catch {
      // do nothing
    }
    const lines: string[] = content.split("\n");
    const previewLines = lines.slice(0, 3);

    const preview: ToolCallPreview[] = [
      {
        type: "text",
        content: "New file content:",
      },
      ...previewLines.map((line) => ({
        type: "text" as const,
        content: line || " ",
        paddingLeft: 2,
      })),
    ];
    if (lines.length > 3) {
      preview.push({
        type: "text",
        content: `... (${lines.length - 3} more lines)`,
      });
    }

    return {
      args: {
        filepath,
        content,
      },
      preview,
    };
  },
  run: async (args: { filepath: string; content: string }): Promise<string> => {
    try {
      // Read existing file content if it exists
      const existing = await readWorkspaceTextFileIfExists(args.filepath);
      const oldContent = existing?.content ?? "";

      // Write has no read requirement of its own, so this only fires when the
      // model did read the file - and what it read is no longer there. A
      // client-owned buffer has no reliable disk mtime to compare.
      if (!isWorkspaceFileServiceActive() && changedSinceSeen(args.filepath)) {
        throw new ContinueError(
          ContinueErrorReason.EditToolFileNotRead,
          `${args.filepath} changed since you read it. Use the ${readFileTool.name} tool to read it again before overwriting it.`,
        );
      }

      // Write new content
      const written = await writeWorkspaceTextFile(args.filepath, args.content);
      markFileAsSeen(written.realPath);
      scheduleFileRefresh(written.realPath);

      // Track lines of code changes if file existed before
      if (oldContent) {
        const { added, removed } = calculateLinesOfCodeDiff(
          oldContent,
          args.content,
        );
        const language = getLanguageFromFilePath(args.filepath);

        if (added > 0) {
          telemetryService.recordLinesOfCodeModified("added", added, language);
        }
        if (removed > 0) {
          telemetryService.recordLinesOfCodeModified(
            "removed",
            removed,
            language,
          );
        }

        // Generate diff for result display
        const diff = generateDiff(oldContent, args.content, args.filepath);

        return `Successfully wrote to file: ${args.filepath}\nDiff:\n${diff}`;
      } else {
        // New file creation - count all lines as added
        const lineCount = args.content.split("\n").length;
        const language = getLanguageFromFilePath(args.filepath);

        telemetryService.recordLinesOfCodeModified(
          "added",
          lineCount,
          language,
        );

        return `${MARKER_FILE_CREATED}: ${args.filepath}`;
      }
    } catch (error) {
      if (error instanceof ContinueError) {
        throw error;
      }
      throw new ContinueError(
        ContinueErrorReason.FileWriteError,
        `Error writing to file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
