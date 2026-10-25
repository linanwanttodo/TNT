import * as path from "path";

import type { LspDiagnostic } from "../lsp/client.js";
import { getLspManager } from "../lsp/manager.js";
import { parseApplyPatch } from "../tools/applyPatch.js";
import { formatDiagnostic } from "../tools/diagnostics.js";
import { logger } from "../utils/logger.js";

/** Tools whose successful run changes a file a language server can check. */
const EDITED_ARGUMENT = {
  Write: "filepath",
  Edit: "file_path",
  MultiEdit: "file_path",
  ApplyPatch: "patch",
} as const;

const MAX_FILES = 3;
const MAX_DIAGNOSTICS = 20;
const MAX_LINE_CHARS = 300;

export interface DiagnosticManager {
  ensureStarted(rootPath: string): Promise<number>;
  collectDiagnostics(filePath: string): Promise<LspDiagnostic[]>;
}

/** The files a successful call touched, in the shape each tool names them. */
export function editedPaths(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string[] {
  if (!args || !(toolName in EDITED_ARGUMENT)) {
    return [];
  }

  if (toolName === "ApplyPatch") {
    if (typeof args.patch !== "string") {
      return [];
    }
    try {
      return [...new Set(parseApplyPatch(args.patch).map((file) => file.path))];
    } catch {
      return [];
    }
  }

  const key = EDITED_ARGUMENT[toolName as keyof typeof EDITED_ARGUMENT];
  if (key === "patch") {
    return [];
  }
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? [value] : [];
}

function bounded(line: string): string {
  return line.length > MAX_LINE_CHARS
    ? `${line.slice(0, MAX_LINE_CHARS)}...`
    : line;
}

/**
 * Runs the configured language servers over the files an edit just changed and
 * returns what they said. Nothing here is allowed to fail the edit: a missing
 * server, a slow one, or a broken one leaves the tool result as it was.
 */
export async function collectPostEditDiagnostics(
  paths: readonly string[],
  manager: DiagnosticManager,
  root: string = process.cwd(),
): Promise<string | undefined> {
  const files = [...new Set(paths)].slice(0, MAX_FILES);
  if (files.length === 0) {
    return undefined;
  }

  try {
    const running = await manager.ensureStarted(root);
    if (running === 0) {
      return undefined;
    }

    const lines: string[] = [];
    for (const file of files) {
      const diagnostics = await manager.collectDiagnostics(
        path.resolve(root, file),
      );
      const room = MAX_DIAGNOSTICS - lines.length;
      for (const diagnostic of diagnostics.slice(0, room)) {
        lines.push(bounded(formatDiagnostic(file, diagnostic)));
      }
      if (lines.length >= MAX_DIAGNOSTICS) {
        break;
      }
    }

    if (lines.length === 0) {
      return undefined;
    }
    return `Diagnostics after this edit (${lines.length}):\n${lines.join("\n")}`;
  } catch (error) {
    logger.debug("Post-edit diagnostics failed", error as Error);
    return undefined;
  }
}

/** The executor's entry point: only successful file-changing tools reach here. */
export async function postEditDiagnostics(
  toolName: string,
  args: Record<string, unknown> | undefined,
): Promise<string | undefined> {
  const paths = editedPaths(toolName, args);
  if (paths.length === 0) {
    return undefined;
  }
  return collectPostEditDiagnostics(paths, getLspManager());
}
