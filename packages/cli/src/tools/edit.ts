import * as fs from "fs";
import path from "path";

import { validateSingleEdit } from "core/edit/searchAndReplace/findAndReplaceUtils.js";
import { executeFindAndReplace } from "core/edit/searchAndReplace/performReplace.js";
import { throwIfFileIsSecurityConcern } from "core/indexing/ignore.js";
import { TntError, TntErrorReason } from "core/util/errors.js";

import { scheduleFileRefresh } from "../retrieval/writeRefresh.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import {
  calculateLinesOfCodeDiff,
  getLanguageFromFilePath,
} from "../telemetry/utils.js";

import { changedSinceSeen, hasSeenFile, markFileAsSeen } from "./fileState.js";
import { EditOperation } from "./multiEdit.js";
import { readFileTool } from "./readFile.js";
import { MARKER_FILE_EDITED } from "./resultMarkers.js";
import { Tool } from "./types.js";
import {
  isWorkspaceFileServiceActive,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
} from "./workspaceFiles.js";
import { generateDiff } from "./writeFile.js";

export function validateAndResolveFilePath(args: any): {
  originalPath: string;
  resolvedPath: string;
} {
  const { file_path } = args;

  if (!file_path) {
    throw new TntError(
      TntErrorReason.FindAndReplaceMissingFilepath,
      "file_path is required",
    );
  }

  const absolutePath = path.isAbsolute(file_path)
    ? file_path
    : path.resolve(process.cwd(), file_path);

  const clientFs = isWorkspaceFileServiceActive();
  const resolvedPath = clientFs ? absolutePath : fs.realpathSync(absolutePath);

  throwIfFileIsSecurityConcern(resolvedPath);

  // Check if file exists. A client-owned buffer can hold a file that is not on
  // disk yet; the read in preprocess is the authoritative check there.
  if (!clientFs && !fs.existsSync(resolvedPath)) {
    throw new TntError(
      TntErrorReason.FileNotFound,
      `File ${file_path} does not exist`,
    );
  }

  // Check if file has been read
  if (!hasSeenFile(resolvedPath)) {
    throw new TntError(
      TntErrorReason.EditToolFileNotRead,
      `You must use the ${readFileTool.name} tool to read ${file_path} before editing it.`,
    );
  }

  // What the model read must still be what is on disk, or the edit is written
  // against a file someone else changed in the meantime. A client buffer has no
  // reliable disk mtime to compare; its write goes through the client anyway.
  if (!clientFs && changedSinceSeen(resolvedPath)) {
    throw new TntError(
      TntErrorReason.EditToolFileNotRead,
      `${file_path} changed since you read it. Use the ${readFileTool.name} tool to read it again before editing.`,
    );
  }

  return { originalPath: file_path, resolvedPath: resolvedPath };
}

export interface EditArgs extends EditOperation {
  file_path: string;
}

export const editTool: Tool = {
  name: "Edit",
  displayName: "Edit",
  readonly: false,
  isBuiltIn: true,
  description: `Performs exact string replacements in a file.

USAGE: 
- ALWAYS use the \`${readFileTool.name}\` tool just before making edits, to understand the file's up-to-date contents and context.
- When editing text from ${readFileTool.name} tool output, ensure you preserve exact whitespace/indentation.
- Always prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable, for instance.

WARNINGS:
- When not using \`replace_all\`, the edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- The edit will FAIL if you have not recently used the \`${readFileTool.name}\` tool to view up-to-date file contents.`,
  parameters: {
    type: "object",
    required: ["file_path", "old_string", "new_string"],
    properties: {
      file_path: {
        type: "string",
        description:
          "Absolute or relative path to the file to modify. Absolute preferred",
      },
      old_string: {
        type: "string",
        description:
          "The text to replace - must be exact including whitespace/indentation",
      },
      new_string: {
        type: "string",
        description:
          "The text to replace it with (MUST be different from old_string)",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences of old_string (default false)",
      },
    },
  },
  preprocess: async (args) => {
    const { old_string, new_string, replace_all } = args as EditArgs;

    const { resolvedPath } = validateAndResolveFilePath(args);

    const { oldString, newString, replaceAll } = validateSingleEdit(
      old_string,
      new_string,
      replace_all,
    );

    const oldContent = (await readWorkspaceTextFile(resolvedPath)).content;
    const newContent = executeFindAndReplace(
      oldContent,
      oldString,
      newString,
      replaceAll ?? false,
      0,
    );

    // Generate diff for preview
    const diff = generateDiff(oldContent, newContent, resolvedPath);

    return {
      args: {
        resolvedPath,
        newContent,
        oldContent,
      },
      preview: [
        {
          type: "text",
          content: "Will make the following changes:",
        },
        {
          type: "diff",
          content: diff,
        },
      ],
    };
  },
  run: async (args: {
    resolvedPath: string;
    newContent: string;
    oldContent: string;
  }) => {
    try {
      // The replacement was computed from the file as it was when the call was
      // planned, and a permission prompt can outlast that. The bytes about to be
      // replaced are checked again here instead of trusting the preview.
      const current = await readWorkspaceTextFile(args.resolvedPath);
      if (current.content !== args.oldContent) {
        throw new TntError(
          TntErrorReason.EditToolFileNotRead,
          `${args.resolvedPath} changed while this edit was awaiting approval. Read it again before editing.`,
        );
      }
      const written = await writeWorkspaceTextFile(
        args.resolvedPath,
        args.newContent,
      );
      markFileAsSeen(written.realPath);
      scheduleFileRefresh(written.realPath);

      // Get lines for telemetry
      const { added, removed } = calculateLinesOfCodeDiff(
        args.oldContent,
        args.newContent,
      );
      const language = getLanguageFromFilePath(args.resolvedPath);

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
      const diff = generateDiff(
        args.oldContent,
        args.newContent,
        args.resolvedPath,
      );

      return `${MARKER_FILE_EDITED} ${args.resolvedPath}\nDiff:\n${diff}`;
    } catch (error) {
      if (error instanceof TntError) {
        throw error;
      }
      throw new TntError(
        TntErrorReason.FileWriteError,
        `Error: failed to edit ${args.resolvedPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
