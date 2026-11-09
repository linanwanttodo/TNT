/* eslint-disable max-lines -- the read projection, the catalog-backed writes and their path validation share one contract */
import { realpathSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  IProjectService,
  type IFileService,
  type ProjectDirectories,
  type ProjectTaskRef,
  type ProjectTree,
  type SaveProjectInput,
  type VirtualProject,
} from "@zcode/services";

import { logger } from "../../utils/logger.js";

import { canonicalWorkspacePath } from "./workspaceScope.js";

const HOST_ID = "local";
/** Same stable prefix the rest of the CLI uses for honest non-implementations. */
const UNAVAILABLE = "ZCODE_UNAVAILABLE";

/**
 * One entry of the process-wide local project catalog. The id is derived from
 * the canonical path so opening the same directory twice cannot create two
 * project identities.
 */
export interface LocalProjectRecord {
  id: string;
  path: string;
  name: string;
  position: number;
  pinned: boolean;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LocalProjectUpdate {
  name?: string;
  position?: number;
  pinned?: boolean;
  deleted?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * The catalog operations the project service needs. Implemented by the
 * services group (`services/webuiProjectCatalog.ts`) and injected, so this
 * module never imports the service registry back into the ZCode host.
 */
export interface LocalProjectCatalog {
  all(): LocalProjectRecord[];
  find(id: string): LocalProjectRecord | undefined;
  findByPath(candidate: string): LocalProjectRecord | undefined;
  ensure(
    candidate: string,
    defaults?: { name?: string; position?: number },
  ): LocalProjectRecord;
  update(id: string, patch: LocalProjectUpdate): LocalProjectRecord | undefined;
  remove(id: string): boolean;
  reorder(ids: readonly string[]): void;
}

/** The narrow part of WorkspaceEngines the project surface drives. */
export interface TntProjectWorkspaceEngines {
  add(candidate: string): Promise<string>;
  /** Disposes the child engine and unregisters the root when one exists. */
  closeWorkspace?(candidate: string): Promise<void>;
}

export interface TntProjectServiceOptions {
  workspacePath: string;
  fileService: Pick<IFileService, "readdir">;
  /** Process-wide catalog; a per-service memory catalog when omitted. */
  catalog?: LocalProjectCatalog;
  workspaceEngines?: TntProjectWorkspaceEngines;
}

function canonicalSync(candidate: string): string | null {
  if (
    typeof candidate !== "string" ||
    !candidate ||
    !path.isAbsolute(candidate)
  ) {
    return null;
  }
  const resolved = path.resolve(candidate);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function sanitizeName(candidate: unknown, projectPath: string): string {
  const raw = typeof candidate === "string" ? candidate : "";
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || path.basename(projectPath) || projectPath;
}

function byPosition(
  left: LocalProjectRecord,
  right: LocalProjectRecord,
): number {
  return (
    left.position - right.position ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  );
}

/**
 * The fallback for callers that do not inject a catalog (tests, a bare host).
 * It behaves like the persisted one but keeps records for this instance only.
 */
export function createMemoryProjectCatalog(): LocalProjectCatalog {
  const records = new Map<string, LocalProjectRecord>();
  const idFor = (projectPath: string): string => `${HOST_ID}:${projectPath}`;
  const find = (id: string): LocalProjectRecord | undefined => {
    const record = records.get(id);
    return record ? { ...record } : undefined;
  };
  const nextPosition = () =>
    Math.max(-1, ...[...records.values()].map((record) => record.position)) + 1;

  return {
    all: () =>
      [...records.values()].sort(byPosition).map((record) => ({ ...record })),
    find,
    findByPath(candidate) {
      const projectPath = canonicalSync(candidate);
      return projectPath ? find(idFor(projectPath)) : undefined;
    },
    ensure(candidate, defaults = {}) {
      const projectPath = canonicalSync(candidate);
      if (!projectPath) {
        throw new Error(
          `A local project path must be an absolute directory: ${candidate}`,
        );
      }
      const id = idFor(projectPath);
      const existing = records.get(id);
      if (existing) {
        return { ...existing };
      }
      const now = Date.now();
      const record: LocalProjectRecord = {
        id,
        path: projectPath,
        name: sanitizeName(defaults.name, projectPath),
        position: defaults.position ?? nextPosition(),
        pinned: false,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      };
      records.set(id, record);
      return { ...record };
    },
    update(id, patch) {
      const existing = records.get(id);
      if (!existing) {
        return undefined;
      }
      const next: LocalProjectRecord = {
        ...existing,
        ...patch,
        updatedAt: patch.updatedAt ?? Date.now(),
      };
      if (patch.name !== undefined) {
        next.name = sanitizeName(patch.name, existing.path);
      }
      records.set(id, next);
      return { ...next };
    },
    remove: (id) => records.delete(id),
    reorder(ids) {
      const ordered = ids.filter((id) => records.has(id));
      ordered.forEach((id, index) => {
        const record = records.get(id);
        if (record) {
          record.position = index;
        }
      });
      const seen = new Set(ordered);
      [...records.values()]
        .filter((record) => !seen.has(record.id))
        .sort(byPosition)
        .forEach((record, index) => {
          record.position = ordered.length + index;
        });
    },
  };
}

function unavailable(operation: string, reason: string): Promise<never> {
  return Promise.reject(new Error(`${UNAVAILABLE}: ${operation}: ${reason}`));
}

function unknownProject(id: string): Error {
  return new Error(`${UNAVAILABLE}: unknown project: ${id}`);
}

/**
 * The shell's project surface backed by the real local workspaces the operator
 * opened. The served workspace is always the host project; every other entry
 * is a directory in the process-wide catalog.
 *
 * TNT has no project task database: its sessions are shown by the session list
 * and are not shell tasks, so `tasks` stays empty and `moveTask` rejects with
 * that reason rather than inventing a mapping. Directory reads still go
 * through the workspace-scoped file service, so a path outside the registered
 * roots (or through a symlink that leaves them) is rejected there.
 */
export function createTntProjectService(
  options: TntProjectServiceOptions,
): IProjectService {
  const workspace =
    canonicalSync(options.workspacePath) ?? path.resolve(options.workspacePath);
  const hostId = `${HOST_ID}:${workspace}`;
  const catalog = options.catalog ?? createMemoryProjectCatalog();
  const engines = options.workspaceEngines;

  const fileStat = (
    target: string,
  ): {
    createdAt: number;
    updatedAt: number;
    status: "available" | "missing";
  } => {
    try {
      const info = statSync(target);
      return {
        createdAt: Math.floor(info.birthtimeMs),
        updatedAt: Math.floor(info.mtimeMs),
        status: info.isDirectory() ? "available" : "missing",
      };
    } catch {
      return { createdAt: 0, updatedAt: 0, status: "missing" };
    }
  };

  const toProject = (record: LocalProjectRecord): VirtualProject => {
    const info = fileStat(record.path);
    return {
      id: record.id,
      hostId: HOST_ID,
      name: record.name,
      nameOverridden:
        record.name !== (path.basename(record.path) || record.path),
      primaryRootStatus: info.status,
      roots: [{ rootPath: record.path, position: 0, isPrimary: true }],
      position: record.position,
      pinned: record.pinned,
      deleted: record.deleted,
      createdAt: record.createdAt > 0 ? record.createdAt : info.createdAt,
      updatedAt: record.updatedAt > 0 ? record.updatedAt : info.updatedAt,
    };
  };

  const hostRecord = (): LocalProjectRecord => {
    const stored = catalog.find(hostId);
    if (stored) {
      return stored;
    }
    const info = fileStat(workspace);
    return {
      id: hostId,
      path: workspace,
      name: path.basename(workspace) || workspace,
      position: 0,
      pinned: false,
      deleted: false,
      createdAt: info.createdAt,
      updatedAt: info.updatedAt,
    };
  };

  const ensureHost = (): LocalProjectRecord => {
    const stored = catalog.find(hostId);
    if (stored) {
      return stored;
    }
    return catalog.ensure(workspace, {
      name: path.basename(workspace) || workspace,
      position: 0,
    });
  };

  const directoriesFor = (record: LocalProjectRecord): ProjectDirectories => ({
    workspacePath: record.path,
    // Deliberately no workspaceIdentity: the shell only accepts remote:*
    // identities there, and these projects are the local host's own.
    additionalDirectories: [],
    projectId: record.id,
  });

  const assertLocalHost = (hostIdValue?: string): void => {
    if (hostIdValue && hostIdValue !== HOST_ID) {
      throw new Error(
        `${UNAVAILABLE}: TNT serves local projects only (host ${hostIdValue})`,
      );
    }
  };

  const assertDirectory = async (target: string): Promise<void> => {
    let info;
    try {
      info = await stat(target);
    } catch (error) {
      throw new Error(
        `${UNAVAILABLE}: workspace does not exist: ${target} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    if (!info.isDirectory()) {
      throw new Error(
        `${UNAVAILABLE}: workspace is not a directory: ${target}`,
      );
    }
  };

  const resolveInputPath = async (candidate: string): Promise<string> => {
    if (!path.isAbsolute(candidate)) {
      throw new Error(
        `${UNAVAILABLE}: workspace root must be absolute: ${candidate}`,
      );
    }
    const absolute = path.resolve(candidate);
    await assertDirectory(absolute);
    return engines ? engines.add(absolute) : canonicalWorkspacePath(absolute);
  };

  const applyMetadata = (
    record: LocalProjectRecord,
    input: SaveProjectInput,
    now: number,
    restore: boolean,
  ): LocalProjectRecord => {
    const patch: LocalProjectUpdate = { updatedAt: now };
    if (typeof input.name === "string" && input.name.trim()) {
      patch.name = input.name.trim();
    }
    if (typeof input.pinned === "boolean") {
      patch.pinned = input.pinned;
    }
    if (restore) {
      patch.deleted = false;
    }
    return catalog.update(record.id, patch) ?? record;
  };

  const activeRecords = (includeDeleted: boolean): LocalProjectRecord[] => {
    const others = catalog.all().filter((record) => record.id !== hostId);
    const all = [hostRecord(), ...others];
    return all
      .filter(
        (record) => record.id === hostId || includeDeleted || !record.deleted,
      )
      .sort(byPosition);
  };

  return {
    async readDirectory(params) {
      const target = path.resolve(params?.path ?? workspace);
      const entries = await options.fileService.readdir({
        path: target,
        includeHidden: params?.includeHidden,
      });
      return { path: target, entries };
    },
    async readProjects(params) {
      assertLocalHost(params?.hostId);
      return activeRecords(params?.includeDeleted === true).map(toProject);
    },
    async readTree(params): Promise<ProjectTree> {
      assertLocalHost(params?.hostId);
      return {
        projects: activeRecords(params?.includeDeleted === true).map(toProject),
        // TNT sessions are not shell tasks; there is no task/project mapping
        // to report until one is implemented.
        tasks: [],
      };
    },
    async saveProject(input) {
      assertLocalHost(input.hostId);
      const now = Date.now();
      const roots = (Array.isArray(input.roots) ? input.roots : []).filter(
        (root): root is string => typeof root === "string" && root.length > 0,
      );
      const primary =
        typeof input.primaryRoot === "string" && input.primaryRoot
          ? input.primaryRoot
          : roots[0];

      // Editing an existing project (rename, pin) or restoring one by id.
      if (input.id) {
        const existing =
          input.id === hostId ? ensureHost() : catalog.find(input.id);
        if (!existing) {
          throw unknownProject(input.id);
        }
        if (primary) {
          const absolute = path.isAbsolute(primary)
            ? await canonicalWorkspacePath(primary)
            : primary;
          if (
            path.resolve(absolute) !== path.resolve(existing.path) &&
            path.resolve(primary) !== path.resolve(existing.path)
          ) {
            throw new Error(
              `${UNAVAILABLE}: saveProject: TNT project roots are fixed; delete and re-add the project to change its workspace`,
            );
          }
        }
        return toProject(applyMetadata(existing, input, now, false));
      }

      if (input.restoreProjectId) {
        const restored = catalog.find(input.restoreProjectId);
        if (!restored) {
          throw unknownProject(input.restoreProjectId);
        }
        return toProject(applyMetadata(restored, input, now, true));
      }

      if (!primary) {
        throw new Error(
          `${UNAVAILABLE}: saveProject: no workspace root was given`,
        );
      }
      if (roots.length > 1) {
        throw new Error(
          `${UNAVAILABLE}: saveProject: TNT projects have a single workspace root (got ${roots.length})`,
        );
      }

      const canonical = await resolveInputPath(primary);
      const existing =
        catalog.findByPath(canonical) ?? catalog.findByPath(primary);
      if (existing) {
        // Opening the same directory again - including one that was removed -
        // keeps the path-derived id and updates the metadata instead of
        // duplicating the project.
        return toProject(applyMetadata(existing, input, now, true));
      }

      const name =
        typeof input.name === "string" && input.name.trim()
          ? input.name.trim()
          : typeof input.defaultName === "string" && input.defaultName.trim()
            ? input.defaultName.trim()
            : path.basename(canonical);
      // The host is the first record so its position stays 0 and a later
      // reorder has a real entry to move.
      ensureHost();
      const record = catalog.ensure(canonical, { name });
      const saved =
        catalog.update(record.id, {
          name,
          pinned: input.pinned === true,
          deleted: false,
          createdAt: record.createdAt || now,
          updatedAt: now,
        }) ?? record;
      return toProject(saved);
    },
    async deleteProject(id, hostIdValue) {
      assertLocalHost(hostIdValue);
      if (id === hostId) {
        throw new Error(
          `${UNAVAILABLE}: deleteProject: the host workspace cannot be removed`,
        );
      }
      const existing = catalog.find(id);
      if (!existing) {
        throw unknownProject(id);
      }
      if (existing.id === hostId) {
        throw new Error(
          `${UNAVAILABLE}: deleteProject: the host workspace cannot be removed`,
        );
      }
      if (!existing.deleted) {
        // Soft delete: the entry stays so restoreProject can bring back the
        // same path-derived id, while the active list no longer shows it.
        catalog.update(id, { deleted: true, updatedAt: Date.now() });
      }
      if (engines?.closeWorkspace) {
        try {
          await engines.closeWorkspace(existing.path);
        } catch (error) {
          // The catalog removal has already succeeded; a failed engine dispose
          // must not resurrect the project in the shell.
          logger.debug("Could not dispose a removed project workspace", {
            project: existing.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    async restoreProject(id, hostIdValue) {
      assertLocalHost(hostIdValue);
      const existing = id === hostId ? ensureHost() : catalog.find(id);
      if (!existing) {
        throw unknownProject(id);
      }
      const restored = catalog.update(existing.id, {
        deleted: false,
        updatedAt: Date.now(),
      });
      return toProject(restored ?? existing);
    },
    moveTask() {
      return unavailable(
        "moveTask",
        "TNT sessions are not movable project tasks",
      );
    },
    async reorderProjects(ids, hostIdValue) {
      assertLocalHost(hostIdValue);
      ensureHost();
      catalog.reorder(ids.filter((id) => typeof id === "string"));
    },
    async prepareSession(params) {
      assertLocalHost(params?.hostId);
      const projectId = params?.projectId;
      if (!projectId) {
        return directoriesFor(hostRecord());
      }
      const record =
        projectId === hostId ? ensureHost() : catalog.find(projectId);
      if (!record) {
        throw unknownProject(projectId);
      }
      if (record.deleted) {
        throw new Error(
          `${UNAVAILABLE}: prepareSession: project is deleted: ${projectId}`,
        );
      }
      await assertDirectory(record.path);
      await engines?.add(record.path);
      return directoriesFor(record);
    },
    measureProjectData() {
      return unavailable(
        "measureProjectData",
        "TNT sessions are not project data",
      );
    },
    deleteProjectData() {
      return unavailable(
        "deleteProjectData",
        "TNT sessions are not project data",
      );
    },
    async resolveSessionDirectories(task: ProjectTaskRef, hostIdValue) {
      assertLocalHost(hostIdValue);
      const candidate =
        task && typeof task.workspacePath === "string"
          ? task.workspacePath
          : "";
      if (!candidate) {
        throw new Error(
          `${UNAVAILABLE}: resolveSessionDirectories: TNT has no project task mapping`,
        );
      }
      const canonical = await canonicalWorkspacePath(candidate);
      const hostCanonical = await canonicalWorkspacePath(workspace);
      const record =
        catalog.findByPath(canonical) ??
        catalog.findByPath(candidate) ??
        (canonical === hostCanonical || path.resolve(candidate) === workspace
          ? hostRecord()
          : undefined);
      if (!record) {
        throw new Error(
          `${UNAVAILABLE}: resolveSessionDirectories: unknown project for task ${task.taskId || "(no id)"}`,
        );
      }
      if (record.deleted) {
        throw new Error(
          `${UNAVAILABLE}: resolveSessionDirectories: project is deleted: ${record.id}`,
        );
      }
      await assertDirectory(record.path);
      await engines?.add(record.path);
      return directoriesFor(record);
    },
  };
}
