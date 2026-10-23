import * as fs from "fs";
import * as path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

/**
 * A file operation the ACP editor owns. When one is installed, reads see the
 * editor's unsaved buffer and writes update it, instead of the last saved copy
 * on disk. The local implementation is the fallback for every other surface.
 */
export interface WorkspaceFileService {
  readTextFile(absolutePath: string): Promise<string>;
  writeTextFile(absolutePath: string, content: string): Promise<void>;
}

let active: WorkspaceFileService | null = null;

export function setWorkspaceFileService(
  service: WorkspaceFileService | null,
): void {
  active = service;
}

export function isWorkspaceFileServiceActive(): boolean {
  return active !== null;
}

export interface WorkspaceRead {
  content: string;
  realPath: string;
  client: boolean;
}

export async function readWorkspaceTextFile(
  filePath: string,
): Promise<WorkspaceRead> {
  const absolute = path.resolve(filePath);
  if (active) {
    try {
      return {
        content: await active.readTextFile(absolute),
        realPath: absolute,
        client: true,
      };
    } catch {
      // The client may not have the file open or may have refused the read;
      // the saved copy is still a valid answer when the path exists locally.
    }
  }

  if (!fs.existsSync(absolute)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  let realPath = absolute;
  try {
    realPath = fs.realpathSync(absolute);
  } catch {
    // A mocked or client-only path need not resolve; the read below is the
    // authoritative check.
  }
  return {
    content: fs.readFileSync(realPath, "utf-8"),
    realPath,
    client: false,
  };
}

export async function readWorkspaceTextFileIfExists(
  filePath: string,
): Promise<WorkspaceRead | null> {
  try {
    return await readWorkspaceTextFile(filePath);
  } catch {
    return null;
  }
}

export interface WorkspaceWrite {
  realPath: string;
  client: boolean;
}

export async function writeWorkspaceTextFile(
  filePath: string,
  content: string,
  options: { createParent?: boolean } = {},
): Promise<WorkspaceWrite> {
  const absolute = path.resolve(filePath);
  if (active) {
    try {
      await active.writeTextFile(absolute, content);
      return { realPath: absolute, client: true };
    } catch {
      // Fall through to the local writer; the editor's request failed, so the
      // change must not silently disappear.
    }
  }

  if (options.createParent) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
  }
  writeFileAtomically(absolute, content);
  return { realPath: absolute, client: false };
}
