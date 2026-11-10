import { realpath } from "node:fs/promises";
import path from "node:path";

import type { IFileService, ITerminalService } from "@zcode/services";

/** Stable prefix so tests and logs can tell a boundary rejection from an IO error. */
export const WORKSPACE_BOUNDARY_PREFIX = "WORKSPACE_BOUNDARY:";

export interface DisposableTerminalService extends ITerminalService {
  disposeAll(): void;
}

/**
 * One workspace path, a set of them, or a live provider so a workspace added
 * at runtime grows the allowed roots without rebuilding the service.
 */
export type WorkspaceRoots =
  string | readonly string[] | (() => readonly string[]);

function boundaryError(label: string, candidate: string): Error {
  return new Error(
    `${WORKSPACE_BOUNDARY_PREFIX}${label} is outside the workspace: ${candidate}`,
  );
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function containsRoot(root: string, candidate: string): boolean {
  const relative = path.relative(candidate, root);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function resolvedRoots(
  source: WorkspaceRoots,
): Promise<{ primary: string; roots: string[] }> {
  const paths =
    typeof source === "function"
      ? source()
      : typeof source === "string"
        ? [source]
        : source;
  const unique: string[] = [];
  for (const entry of paths) {
    if (!entry) {
      continue;
    }
    const absolute = path.resolve(entry);
    if (!unique.includes(absolute)) {
      unique.push(absolute);
    }
  }
  if (unique.length === 0) {
    unique.push(process.cwd());
  }
  const canonical = await Promise.all(unique.map(realpathNearest));
  return { primary: canonical[0] as string, roots: canonical };
}

/** Canonical form of a workspace path; a missing tail is kept unchanged. */
export async function canonicalWorkspacePath(
  candidate: string,
): Promise<string> {
  return realpathNearest(path.resolve(candidate));
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
 * Resolves `candidate` (absolute, or relative to the primary root) and rejects
 * it when the canonical result is not one of the registered roots or below
 * one. Symlinks are followed on both sides before the comparison, so an
 * in-workspace link that points outside is rejected.
 */
export async function resolveWithinRoots(
  roots: WorkspaceRoots,
  candidate: string,
  label: string,
): Promise<string> {
  const { primary, roots: allowed } = await resolvedRoots(roots);
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(primary, candidate);
  const resolved = await realpathNearest(absolute);
  if (!allowed.some((root) => isWithinRoot(root, resolved))) {
    throw boundaryError(label, candidate);
  }
  return resolved;
}

export async function resolveReadableDirectory(
  roots: WorkspaceRoots,
  candidate: string,
  label: string,
): Promise<string> {
  const { primary, roots: allowed } = await resolvedRoots(roots);
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(primary, candidate);
  const resolved = await realpathNearest(absolute);
  if (
    !allowed.some(
      (root) => isWithinRoot(root, resolved) || containsRoot(root, resolved),
    )
  ) {
    throw boundaryError(label, candidate);
  }
  return resolved;
}

/**
 * The single-root form kept for callers that never grow their workspace set.
 */
export async function resolveWithinWorkspace(
  workspacePath: string,
  candidate: string,
  label: string,
): Promise<string> {
  return resolveWithinRoots(workspacePath, candidate, label);
}

/**
 * The file service with every caller-supplied path checked against the
 * connection's registered workspace roots. Writes are checked too, so a path
 * through a symlink cannot land outside a checkout.
 *
 * `ensureConversationWorkspace`, `createDefaultWorkspace` and
 * `createScratchWorkspace` take no path from the caller: they provision
 * app-owned directories under the TNT-owned ZCode home, so there is nothing to
 * scope and they delegate unchanged.
 */
export function createWorkspaceScopedFileService(
  base: IFileService,
  workspaceRoots: WorkspaceRoots,
): IFileService {
  const check = (candidate: string): Promise<string> =>
    resolveWithinRoots(workspaceRoots, candidate, "file path");
  const checkReadableDirectory = (candidate: string): Promise<string> =>
    resolveReadableDirectory(workspaceRoots, candidate, "file path");

  return {
    async searchWorkspaceFiles(params) {
      return base.searchWorkspaceFiles({
        ...params,
        rootPath: await check(params.rootPath),
      });
    },
    async readdir(params) {
      return base.readdir({
        ...params,
        path: await checkReadableDirectory(params.path),
      });
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
 * cwd defaults to the primary workspace (instead of the host's home directory)
 * and an explicit cwd must resolve inside one of the registered roots.
 */
export function createWorkspaceScopedTerminalService(
  base: DisposableTerminalService,
  workspaceRoots: WorkspaceRoots,
): DisposableTerminalService {
  return {
    async create(params) {
      const cwd = await resolveWithinRoots(
        workspaceRoots,
        params.cwd ?? (await resolvedRoots(workspaceRoots)).primary,
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
