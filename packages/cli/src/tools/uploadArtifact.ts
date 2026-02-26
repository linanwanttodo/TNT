import * as fs from "fs";
import * as path from "path";

import { TntError, TntErrorReason } from "core/util/errors.js";

import { getCurrentSessionId } from "../session/index.js";
import { ensureSessionScopedDir } from "../session/paths.js";
import { toDisplayPath } from "../utils/displayPath.js";
import { logger } from "../utils/logger.js";

import { Tool } from "./types.js";

const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_SESSION_BYTES = 500 * 1024 * 1024;

/** The types a reviewer can actually open; anything else is refused by name. */
const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".log",
  ".txt",
  ".json",
  ".xml",
  ".csv",
  ".html",
]);

function bytesIn(dir: string, except: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (full !== except) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

export const uploadArtifactTool: Tool = {
  name: "UploadArtifact",
  displayName: "Upload Artifact",
  description:
    "Copy a file (screenshot, video, log) into the current session's artifacts so the user can open it. Supported: images (png, jpg, jpeg, gif, webp), videos (mp4, mov, avi, webm), and text files (log, txt, json, xml, csv, html). Maximum file size: 50MB, maximum session total: 500MB. An artifact with the same name is replaced.",
  parameters: {
    type: "object",
    required: ["filePath"],
    properties: {
      filePath: {
        type: "string",
        description:
          "Absolute path to the file to save (e.g., /tmp/screenshot.png)",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async (args: { filePath: string }): Promise<string> => {
    const trimmedPath = args.filePath?.trim();
    if (!trimmedPath) {
      throw new TntError(
        TntErrorReason.Unspecified,
        "filePath is required to save an artifact.",
      );
    }
    if (!fs.existsSync(trimmedPath)) {
      throw new TntError(
        TntErrorReason.Unspecified,
        `File not found: ${trimmedPath}`,
      );
    }

    const stats = fs.statSync(trimmedPath);
    if (!stats.isFile()) {
      throw new TntError(
        TntErrorReason.Unspecified,
        `Not a file: ${trimmedPath}`,
      );
    }

    const filename = path.basename(trimmedPath);
    const extension = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new TntError(
        TntErrorReason.Unspecified,
        `File type not supported: ${extension || filename}. Only images (png, jpg, jpeg, gif, webp), videos (mp4, mov, avi, webm), and text files (log, txt, json, xml, csv, html) can be saved as artifacts.`,
      );
    }

    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    if (stats.size > MAX_ARTIFACT_BYTES) {
      throw new TntError(
        TntErrorReason.Unspecified,
        `File is too large (${sizeMB} MB). Maximum allowed size is 50MB. Consider compressing the file or splitting it into smaller parts.`,
      );
    }

    const dir = ensureSessionScopedDir("artifacts", getCurrentSessionId());
    const target = path.join(dir, filename);
    if (stats.size + bytesIn(dir, target) > MAX_SESSION_BYTES) {
      throw new TntError(
        TntErrorReason.Unspecified,
        "Session artifacts are at their 500MB limit. Delete a session you no longer need, or save fewer files.",
      );
    }

    // Copied under a temporary name and renamed over the real one, so a crash
    // mid-copy cannot leave a truncated file carrying the name the user was told.
    const partial = `${target}.${process.pid}.partial`;
    try {
      fs.copyFileSync(trimmedPath, partial);
      fs.renameSync(partial, target);
    } catch (error) {
      fs.rmSync(partial, { force: true });
      throw new TntError(
        TntErrorReason.Unspecified,
        `Failed to save artifact: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    logger.info(`Saved artifact: ${filename} (${sizeMB} MB)`);
    return `Artifact saved: ${toDisplayPath(target)} (${sizeMB} MB).`;
  },
};
