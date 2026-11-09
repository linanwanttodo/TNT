import { statSync } from "node:fs";
import path from "node:path";

import {
  IProjectService,
  type IFileService,
  type ProjectDirectories,
  type ProjectTree,
  type VirtualProject,
} from "@zcode/services";

const HOST_ID = "local";

export interface TntProjectServiceOptions {
  workspacePath: string;
  fileService: Pick<IFileService, "readdir">;
}

/**
 * The shell's project surface backed by the one workspace this engine serves.
 * TNT has no project catalog database: the workspace directory is the project,
 * its timestamps come from the filesystem, and tasks are TNT sessions (shown by
 * the session list), not shell tasks. Mutations that would need a catalog or a
 * new engine reject rather than invent one.
 */
export function createTntProjectService(
  options: TntProjectServiceOptions,
): IProjectService {
  const workspace = path.resolve(options.workspacePath);
  const id = `${HOST_ID}:${workspace}`;
  const name = path.basename(workspace) || workspace;

  const project = (): VirtualProject => {
    let createdAt = 0;
    let updatedAt = 0;
    try {
      const stat = statSync(workspace);
      createdAt = Math.floor(stat.birthtimeMs);
      updatedAt = Math.floor(stat.mtimeMs);
    } catch {
      // A missing workspace still appears; the shell reports its root status.
    }
    return {
      id,
      hostId: HOST_ID,
      name,
      nameOverridden: false,
      primaryRootStatus: "available",
      roots: [{ rootPath: workspace, position: 0, isPrimary: true }],
      position: 0,
      pinned: false,
      deleted: false,
      createdAt,
      updatedAt,
    };
  };

  const directories = (): ProjectDirectories => ({
    workspacePath: workspace,
    // Deliberately no workspaceIdentity: the shell only accepts remote:*
    // identities there, and this project is the local host's own workspace.
    additionalDirectories: [],
    projectId: id,
  });

  const unavailable = (operation: string): Promise<never> =>
    Promise.reject(
      new Error(`ZCODE_UNAVAILABLE: TNT project ${operation} is local-only`),
    );

  return {
    async readDirectory(params) {
      const target = path.resolve(params?.path ?? workspace);
      const entries = await options.fileService.readdir({
        path: target,
        includeHidden: params?.includeHidden,
      });
      return { path: target, entries };
    },
    async readProjects() {
      return [project()];
    },
    async readTree(): Promise<ProjectTree> {
      return { projects: [project()], tasks: [] };
    },
    saveProject: () => unavailable("saveProject"),
    deleteProject: () => unavailable("deleteProject"),
    restoreProject: () => unavailable("restoreProject"),
    moveTask: () => unavailable("moveTask"),
    reorderProjects: () => unavailable("reorderProjects"),
    async prepareSession() {
      return directories();
    },
    measureProjectData: () => unavailable("measureProjectData"),
    deleteProjectData: () => unavailable("deleteProjectData"),
    async resolveSessionDirectories() {
      return directories();
    },
  };
}
