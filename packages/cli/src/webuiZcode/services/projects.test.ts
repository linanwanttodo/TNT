import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebUiProjectCatalog } from "../../services/webuiProjectCatalog.js";
import { createSession } from "../../session/index.js";
import { sessionStore } from "../../session/store.js";

import {
  createTntProjectService,
  type TntProjectWorkspaceEngines,
} from "./projects.js";

const cleanups: string[] = [];
let previousGlobalDir: string | undefined;
let testGlobalDir: string;

beforeEach(() => {
  previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  testGlobalDir = mkdtempSync(path.join(tmpdir(), "tnt-project-global-"));
  process.env.TNT_GLOBAL_DIR = testGlobalDir;
  sessionStore.clearAll();
});

afterEach(() => {
  sessionStore.clearAll();
  sessionStore.releaseAll();
  rmSync(testGlobalDir, { recursive: true, force: true });
  if (previousGlobalDir === undefined) {
    delete process.env.TNT_GLOBAL_DIR;
  } else {
    process.env.TNT_GLOBAL_DIR = previousGlobalDir;
  }
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tnt-project-"));
  cleanups.push(dir);
  return dir;
}

function engineStub(): TntProjectWorkspaceEngines & {
  added: string[];
  closed: string[];
} {
  const added: string[] = [];
  const closed: string[] = [];
  return {
    added,
    closed,
    async add(candidate) {
      added.push(candidate);
      return realpathSync(candidate);
    },
    async closeWorkspace(candidate) {
      closed.push(candidate);
    },
  };
}

function build(
  host: string,
  options: {
    catalog?: ReturnType<typeof createWebUiProjectCatalog>;
    engines?: ReturnType<typeof engineStub>;
  } = {},
) {
  const engines = options.engines ?? engineStub();
  const catalog =
    options.catalog ??
    createWebUiProjectCatalog(path.join(host, "state", "webui-projects.json"));
  const service = createTntProjectService({
    workspacePath: host,
    fileService: { readdir: async () => [] },
    catalog,
    workspaceEngines: engines,
  });
  return { service, catalog, engines };
}

describe("createTntProjectService", () => {
  it("projects the served workspace as the host project", async () => {
    const root = workspace();
    const { service, engines } = build(root);

    const projects = await service.readProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: `local:${realpathSync(root)}`,
      name: path.basename(root),
      hostId: "local",
      roots: [{ rootPath: realpathSync(root), isPrimary: true }],
      pinned: false,
      deleted: false,
      primaryRootStatus: "available",
    });
    expect(engines.added).toEqual([]);

    const tree = await service.readTree();
    expect(tree.projects).toEqual(projects);
    expect(tree.tasks).toEqual([]);
  });

  it("lists the workspace's sessions as project tasks", async () => {
    const root = workspace();
    const { service } = build(root);
    const host = realpathSync(root);

    const session = createSession([], "sess-task-1", {
      source: "serve",
      persistEmpty: false,
    });
    session.workspaceDirectory = host;
    session.title = "Fix the flaky test";
    sessionStore.sync(session);

    // A session recorded in another workspace must not leak into this project.
    const other = workspace();
    const foreign = createSession([], "sess-task-other", {
      source: "serve",
      persistEmpty: false,
    });
    foreign.workspaceDirectory = realpathSync(other);
    sessionStore.sync(foreign);

    const tree = await service.readTree();
    expect(tree.tasks.map((task) => task.taskId)).toEqual(["sess-task-1"]);
    expect(tree.tasks[0]).toMatchObject({
      title: "Fix the flaky test",
      workspacePath: host,
      projectId: `local:${host}`,
      hostId: "local",
      archived: false,
    });
    expect(tree.tasks[0]!.createdAt).toBeGreaterThan(0);
  });

  it("adds a workspace, calls engines.add, and persists it", async () => {
    const host = workspace();
    const opened = workspace();
    const { service, engines, catalog } = build(host);
    const canonical = realpathSync(opened);

    const saved = await service.saveProject({ roots: [opened] });
    expect(saved).toMatchObject({
      id: `local:${canonical}`,
      name: path.basename(opened),
      hostId: "local",
      roots: [{ rootPath: canonical, isPrimary: true }],
      deleted: false,
    });
    expect(engines.added).toEqual([path.resolve(opened)]);

    const projects = await service.readProjects();
    expect(projects.map((project) => project.id)).toEqual([
      `local:${realpathSync(host)}`,
      `local:${canonical}`,
    ]);

    // A fresh catalog over the same file sees the persisted record.
    const reloaded = createWebUiProjectCatalog(catalog.filePath);
    expect(reloaded.all().map((record) => record.path)).toEqual([
      realpathSync(host),
      canonical,
    ]);
  });

  it("reuses an existing root and updates name and pin instead of duplicating", async () => {
    const host = workspace();
    const opened = workspace();
    const { service, catalog } = build(host);

    const first = await service.saveProject({ roots: [opened] });
    const second = await service.saveProject({
      roots: [opened],
      name: "Renamed workspace",
      pinned: true,
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Renamed workspace");
    expect(second.pinned).toBe(true);
    await expect(service.readProjects()).resolves.toHaveLength(2);
    expect(catalog.all()).toHaveLength(2);
  });

  it("keeps tasks empty and rejects moving a task with a clear reason", async () => {
    const root = workspace();
    const { service } = build(root);

    await expect(
      service.moveTask({
        task: { workspacePath: root, taskId: "session-1" },
        projectId: `local:${realpathSync(root)}`,
      }),
    ).rejects.toThrow("TNT sessions are not movable project tasks");
    expect((await service.readTree()).tasks).toEqual([]);
  });

  it("soft deletes a non-host project, disposes its engine, and restores it", async () => {
    const host = workspace();
    const opened = workspace();
    const { service, engines } = build(host);
    const saved = await service.saveProject({ roots: [opened] });

    await service.deleteProject(saved.id, "local");
    expect(engines.closed).toEqual([realpathSync(opened)]);

    expect((await service.readProjects()).map((project) => project.id)).toEqual(
      [`local:${realpathSync(host)}`],
    );
    const withDeleted = await service.readProjects({ includeDeleted: true });
    expect(
      withDeleted.find((project) => project.id === saved.id),
    ).toMatchObject({ deleted: true });

    // Deleting twice is idempotent.
    await expect(
      service.deleteProject(saved.id, "local"),
    ).resolves.toBeUndefined();

    const restored = await service.restoreProject(saved.id, "local");
    expect(restored.deleted).toBe(false);
    expect(
      (await service.readProjects()).map((project) => project.id),
    ).toContain(saved.id);
  });

  it("never deletes the host project", async () => {
    const root = workspace();
    const { service } = build(root);
    const hostId = `local:${realpathSync(root)}`;

    await expect(service.deleteProject(hostId, "local")).rejects.toThrow(
      "host workspace cannot be removed",
    );
    expect((await service.readProjects()).map((project) => project.id)).toEqual(
      [hostId],
    );

    const pinned = await service.saveProject({ id: hostId, pinned: true });
    expect(pinned).toMatchObject({ id: hostId, pinned: true, deleted: false });
  });

  it("persists reorder and pin across a reload", async () => {
    const host = workspace();
    const first = workspace();
    const second = workspace();
    const { service, catalog } = build(host);
    const savedFirst = await service.saveProject({ roots: [first] });
    const savedSecond = await service.saveProject({ roots: [second] });
    const hostId = `local:${realpathSync(host)}`;

    await service.reorderProjects(
      [savedSecond.id, savedFirst.id, hostId],
      "local",
    );
    await service.saveProject({ id: savedFirst.id, pinned: true });

    const reloaded = createWebUiProjectCatalog(catalog.filePath);
    const reloadedService = createTntProjectService({
      workspacePath: host,
      fileService: { readdir: async () => [] },
      catalog: reloaded,
    });
    const projects = await reloadedService.readProjects();

    expect(projects.map((project) => project.id)).toEqual([
      savedSecond.id,
      savedFirst.id,
      hostId,
    ]);
    expect(
      projects.find((project) => project.id === savedFirst.id)?.pinned,
    ).toBe(true);
  });

  it("rejects unknown projects and paths it cannot trust", async () => {
    const host = workspace();
    const { service } = build(host);

    await expect(
      service.prepareSession({ projectId: "local:/does/not/exist" }),
    ).rejects.toThrow("unknown project");
    await expect(
      service.resolveSessionDirectories(
        { workspacePath: "/does/not/exist", taskId: "task-1" },
        "local",
      ),
    ).rejects.toThrow("unknown project");
    await expect(
      service.saveProject({ id: "local:/does/not/exist", pinned: true }),
    ).rejects.toThrow("unknown project");
    await expect(
      service.saveProject({ roots: ["relative/path"] }),
    ).rejects.toThrow("must be absolute");
    await expect(
      service.saveProject({ roots: [path.join(host, "missing")] }),
    ).rejects.toThrow("does not exist");
    await expect(
      service.prepareSession({ hostId: "remote-1" }),
    ).rejects.toThrow("serves local projects only");
  });

  it("returns a catalog project's workspace for a session", async () => {
    const host = workspace();
    const opened = workspace();
    const { service } = build(host);
    const saved = await service.saveProject({ roots: [opened] });

    await expect(
      service.prepareSession({ projectId: saved.id, hostId: "local" }),
    ).resolves.toEqual({
      workspacePath: realpathSync(opened),
      additionalDirectories: [],
      projectId: saved.id,
    });
    await expect(
      service.resolveSessionDirectories(
        { workspacePath: saved.roots[0]!.rootPath, taskId: "task-1" },
        "local",
      ),
    ).resolves.toMatchObject({
      workspacePath: realpathSync(opened),
      projectId: saved.id,
    });
  });

  it("reads a directory through the scoped file service", async () => {
    const root = workspace();
    const seen: string[] = [];
    const service = createTntProjectService({
      workspacePath: root,
      fileService: {
        readdir: async ({ path: target }) => {
          seen.push(target);
          return [];
        },
      },
      catalog: createWebUiProjectCatalog(
        path.join(root, "state", "webui-projects.json"),
      ),
    });

    await service.readDirectory();
    await service.readDirectory({ path: path.join(root, "src") });

    expect(seen).toEqual([realpathSync(root), path.join(root, "src")]);
  });
});
