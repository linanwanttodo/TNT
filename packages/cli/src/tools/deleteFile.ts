import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { TntError, TntErrorReason } from "core/util/errors.js";

import { globalDir } from "../config/globalDir.js";
import { t } from "../i18n/index.js";
import {
  isWithinWorkspace,
  workspaceRoot,
} from "../permissions/workspacePath.js";

import { Tool } from "./types.js";

/**
 * A deletion this CLI performs is recoverable: the path is moved into the
 * global trash first, and the result names where it went. Deleting the
 * workspace root or `.git` is refused outright, because no trash entry makes
 * either of those a reasonable single call.
 */
export interface DeletablePath {
  absolute: string;
  isDirectory: boolean;
  isSymlink: boolean;
}

export function assertDeletablePath(
  filepath: unknown,
  root: string = workspaceRoot(),
): DeletablePath {
  if (typeof filepath !== "string" || filepath.trim() === "") {
    throw new TntError(TntErrorReason.Unspecified, "Delete needs a filepath.");
  }

  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(filepath);
  if (absolute === resolvedRoot) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "Refusing to delete the workspace root.",
    );
  }

  // Decide containment before touching the path, so a path outside the
  // workspace is refused as such even when it does not exist.
  if (!isWithinWorkspace(path.dirname(absolute), resolvedRoot)) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Delete only removes paths inside the workspace: ${filepath}`,
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    throw new TntError(
      TntErrorReason.Unspecified,
      `No such file or directory: ${filepath}`,
    );
  }

  // Deleting a symlink removes the link, not what it points at, so containment
  // is decided by the link's directory. A regular path must be inside itself.
  const container = stat.isSymbolicLink() ? path.dirname(absolute) : absolute;
  if (!isWithinWorkspace(container, resolvedRoot)) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Delete only removes paths inside the workspace: ${filepath}`,
    );
  }

  const relative = path.relative(resolvedRoot, absolute);
  if (relative.split(path.sep)[0] === ".git") {
    throw new TntError(
      TntErrorReason.Unspecified,
      "Refusing to delete .git: version history is not recoverable from the trash.",
    );
  }

  return {
    absolute,
    isDirectory: stat.isDirectory(),
    isSymlink: stat.isSymbolicLink(),
  };
}

function trashDestination(absolute: string): string {
  const relative = path.relative(workspaceRoot(), absolute);
  const safeRelative = relative.startsWith("..")
    ? path.basename(absolute)
    : relative;
  const stamp = `${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  return path.join(globalDir(), "trash", stamp, safeRelative);
}

function moveToTrash(absolute: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    fs.renameSync(absolute, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    fs.cpSync(absolute, destination, {
      recursive: true,
      preserveTimestamps: true,
    });
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}

export const deleteFileTool: Tool = {
  name: "Delete",
  displayName: "Delete",
  description: `Delete a file or directory from the workspace. The path is moved into the CLI's trash first, and the result names where it went, so a mistaken deletion can be restored by moving it back. Use Bash's rm only when the workspace trash is explicitly not wanted.
Directories need recursive: true; deleting one without it is refused rather than guessed. The workspace root and .git are never deleted.`,
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "The path to delete",
      },
      recursive: {
        type: "boolean",
        description: "Required for a directory; ignored for a file",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => {
    const filepath = args?.filepath;
    if (typeof filepath !== "string") {
      throw new Error(t("tools.filepathMustBeString"));
    }
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will delete ${filepath} (recoverable from the trash)`,
        },
      ],
    };
  },
  run: async (args: { filepath: string; recursive?: boolean }) => {
    const target = assertDeletablePath(args.filepath);
    if (target.isDirectory && args.recursive !== true) {
      throw new TntError(
        TntErrorReason.Unspecified,
        `${args.filepath} is a directory. Pass recursive: true to delete it.`,
      );
    }

    const destination = trashDestination(target.absolute);
    moveToTrash(target.absolute, destination);
    const relative =
      path.relative(workspaceRoot(), target.absolute) || target.absolute;
    return `Deleted ${relative}. It is recoverable at ${destination}; move it back to restore it.`;
  },
};
