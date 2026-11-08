import { realpath } from "node:fs/promises";
import path from "node:path";

import type { IFileService, ITerminalService } from "@zcode/services";

/** Stable prefix so tests and logs can tell a boundary rejection from an IO error. */
export const WORKSPACE_BOUNDARY_PREFIX = "WORKSPACE_BOUNDARY:";

export interface DisposableTerminalService extends ITerminalService {
  disposeAll(): void;
}

function boundaryError(label: string, candidate: string): Error {
  return new Error(
    `${WORKSPACE_BOUNDARY_PREFIX}${label} is outside the workspace: ${candidate}`,
  );
}

/**
 * `realpath` that still answers for a path that does not exist yet: the
 * nearest existing ancestor is resolved (following every symlink on the way)
 * and the missing tail is appended unchanged. Without this a write to a new
 * file would skip the symlink check.
 */
async function realpathNearest(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const missing: string[] = [];
  let current = candidate;
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(candidate);
    }
    missing.unshift(path.basename(current));
    current = parent;
    try {
      return path.join(await realpath(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

/**
 * Resolves `candidate` (absolute, or relative to the workspace) and rejects it
 * when the canonical result is not the workspace or below it. Symlinks are
 * followed on both sides before the comparison, so an in-workspace link that
 * points outside is rejected.
 */
export async function resolveWithinWorkspace(
  workspacePath: string,
  candidate: string,
  label: string,
): Promise<string> {
  const root = await realpathNearest(path.resolve(workspacePath));
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  const resolved = await realpathNearest(absolute);
  const relative = path.relative(root, resolved);
  const escapes =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (escapes) {
    throw boundaryError(label, candidate);
  }
  return resolved;
}

/**
 * The file service with every caller-supplied path checked against the
 * connection's workspace. Writes are checked too, so a path through a symlink
 * cannot land outside the checkout.
 *
 * `ensureConversationWorkspace`, `createDefaultWorkspace` and
 * `createScratchWorkspace` take no path from the caller: they provision
 * app-owned directories under the TNT-owned ZCode home, so there is nothing to
 * scope and they delegate unchanged.
 */
export function createWorkspaceScopedFileService(
  base: IFileService,
  workspacePath: string,
): IFileService {
  const check = (candidate: string): Promise<string> =>
    resolveWithinWorkspace(workspacePath, candidate, "file path");

  return {
    async searchWorkspaceFiles(params) {
      return base.searchWorkspaceFiles({
        ...params,
        rootPath: await check(params.rootPath),
      });
    },
    async readdir(params) {
      return base.readdir({ ...params, path: await check(params.path) });
    },
    async stat(params) {
      return base.stat({ path: await check(params.path) });
    },
    async checkFilesExist(params) {
      const paths = await Promise.all(
        params.paths.map((entry) => check(entry)),
      );
      return base.checkFilesExist({ paths });
    },
    async resolvePath(params) {
      return base.resolvePath({ path: await check(params.path) });
    },
    ensureConversationWorkspace: () => base.ensureConversationWorkspace(),
    createDefaultWorkspace: () => base.createDefaultWorkspace(),
    createScratchWorkspace: (params) => base.createScratchWorkspace(params),
    async readTextFile(params) {
      return base.readTextFile({ ...params, path: await check(params.path) });
    },
    async readMediaPreview(params) {
      return base.readMediaPreview({
        ...params,
        path: await check(params.path),
      });
    },
    async readFileRange(params) {
      return base.readFileRange({ ...params, path: await check(params.path) });
    },
    async readBinaryPreview(params) {
      return base.readBinaryPreview({
        ...params,
        path: await check(params.path),
      });
    },
    async listWorkspaceFilesLength(params) {
      return base.listWorkspaceFilesLength({
        rootPath: await check(params.rootPath),
      });
    },
    async listWorkspaceFilesRange(params) {
      return base.listWorkspaceFilesRange({
        ...params,
        rootPath: await check(params.rootPath),
      });
    },
    async readWorkspaceFileSearchIgnore(params) {
      return base.readWorkspaceFileSearchIgnore({
        rootPath: await check(params.rootPath),
      });
    },
    async applyWorkspaceFileSearchIgnoreTransform(params) {
      return base.applyWorkspaceFileSearchIgnoreTransform({
        ...params,
        rootPath: await check(params.rootPath),
      });
    },
    async writeWorkspaceFileSearchIgnore(params) {
      return base.writeWorkspaceFileSearchIgnore({
        ...params,
        rootPath: await check(params.rootPath),
      });
    },
  };
}

/**
 * Terminal creation is the one place this service takes an OS path. A missing
 * cwd defaults to the workspace (instead of the host's home directory) and an
 * explicit cwd must resolve inside it.
 */
export function createWorkspaceScopedTerminalService(
  base: DisposableTerminalService,
  workspacePath: string,
): DisposableTerminalService {
  return {
    async create(params) {
      const cwd = await resolveWithinWorkspace(
        workspacePath,
        params.cwd ?? workspacePath,
        "terminal cwd",
      );
      return base.create({ ...params, cwd });
    },
    write: (params) => base.write(params),
    resize: (params) => base.resize(params),
    dispose: (params) => base.dispose(params),
    onDynamicData: (id) => base.onDynamicData(id),
    onDynamicExit: (id) => base.onDynamicExit(id),
    disposeAll: () => base.disposeAll(),
  };
}
