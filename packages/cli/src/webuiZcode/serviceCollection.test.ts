import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  IBroadcastService,
  IFileService,
  IFileWatcherService,
  IGitCheckpointService,
  IGitService,
  IModelSelectionService,
  IPluginManagementService,
  IPluginsService,
  IProjectService,
  IRemoteProjectService,
  ISettingService,
  ISystemService,
  ITaskGroupService,
  ITerminalService,
  IZCodeAgentService,
  IZCodeSessionService,
  type ServiceCollection,
} from "@zcode/services";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createWebUiProjectCatalog } from "../services/webuiProjectCatalog.js";

import {
  buildZcodeServiceCollection,
  ZCODE_LOCAL_SERVICE_DESCRIPTORS,
} from "./serviceCollection.js";
import {
  createLocalZcodeServices,
  type LocalZcodeServices,
} from "./services/local.js";
import { ZCODE_UNAVAILABLE_PREFIX } from "./services/stubs.js";
import { WORKSPACE_BOUNDARY_PREFIX } from "./services/workspaceScope.js";
import type { WorkspaceEngines } from "./workspaceEngines.js";

const execFileAsync = promisify(execFile);

const cleanups: Array<() => Promise<void> | void> = [];
let previousGlobalDir: string | undefined;
let previousZcodeHome: string | undefined;
let testGlobalDir: string;

beforeAll(() => {
  previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  previousZcodeHome = process.env.ZCODE_DESKTOP_HOME_DIR;
  testGlobalDir = mkdtempSync(join(tmpdir(), "tnt-zcode-collection-"));
  process.env.TNT_GLOBAL_DIR = testGlobalDir;
  process.env.ZCODE_DESKTOP_HOME_DIR = join(testGlobalDir, "zcode-home");
});

afterAll(() => {
  rmSync(testGlobalDir, { recursive: true, force: true });
  restoreEnv("TNT_GLOBAL_DIR", previousGlobalDir);
  restoreEnv("ZCODE_DESKTOP_HOME_DIR", previousZcodeHome);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

function registerCleanup(cleanup: () => Promise<void> | void): void {
  cleanups.push(cleanup);
}

function createBundle(): LocalZcodeServices {
  const bundle = createLocalZcodeServices({
    settingHomeDir: join(testGlobalDir, "zcode-home"),
  });
  registerCleanup(() => bundle.dispose());
  return bundle;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  registerCleanup(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function buildCollection(
  workspacePath: string,
  localServices: LocalZcodeServices,
): Promise<ServiceCollection> {
  const collection = await buildZcodeServiceCollection({
    workspacePath,
    localServices,
  });
  registerCleanup(() => collection.dispose());
  return collection;
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const PTY_UNAVAILABLE_MARKERS = [
  "node-pty is unavailable",
  "Failed to load native module",
  "spawn-helper",
  "posix_spawnp failed",
];

function isPtyUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return PTY_UNAVAILABLE_MARKERS.some((marker) => message.includes(marker));
}

describe("buildZcodeServiceCollection", () => {
  it("registers a real instance for every local channel", async () => {
    const bundle = createBundle();
    const collection = await buildCollection(process.cwd(), bundle);

    expect(collection.get(IFileService)).not.toBe(bundle.fileService);
    expect(collection.get(IGitService)).toBe(bundle.gitService);
    expect(collection.get(ISettingService)).toBe(bundle.settingService);
    expect(collection.get(ISystemService)).toBe(bundle.systemService);
    expect(collection.get(IBroadcastService)).toBe(bundle.broadcastService);
    expect(collection.get(IPluginsService)).toBe(bundle.pluginsService);
    expect(collection.get(IPluginManagementService)).toBe(
      bundle.pluginManagementService,
    );
    expect(collection.get(ITerminalService)).toBeDefined();
    expect(collection.get(IFileWatcherService)).toBeDefined();
    // The shell loads its model picker and remote-project directory on paint;
    // both are answered locally instead of surfacing an unavailable toast.
    expect(
      await collection.get(IModelSelectionService).getView(),
    ).toBeDefined();
    expect(await collection.get(IRemoteProjectService).readDirectory()).toEqual(
      { hosts: [], entries: [] },
    );
    const tree = await collection.get(IProjectService).readTree();
    expect(tree.projects[0]?.roots[0]?.rootPath).toBe(resolve(process.cwd()));
    expect(tree.tasks).toEqual([]);

    expect(
      new Set(ZCODE_LOCAL_SERVICE_DESCRIPTORS.map((d) => d.channelName)),
    ).toEqual(
      new Set([
        IFileService.channelName,
        IGitService.channelName,
        ISettingService.channelName,
        ISystemService.channelName,
        ITerminalService.channelName,
        IFileWatcherService.channelName,
        IBroadcastService.channelName,
        IPluginsService.channelName,
        IPluginManagementService.channelName,
        IModelSelectionService.channelName,
        IRemoteProjectService.channelName,
        IProjectService.channelName,
        ITaskGroupService.channelName,
      ]),
    );
  });

  it("injects the project catalog and workspace registry into the project service", async () => {
    const dir = await tempDir("tnt-zcode-project-");
    const catalog = createWebUiProjectCatalog(
      join(testGlobalDir, "webui-projects.json"),
    );
    const added: string[] = [];
    const engines = {
      add: async (candidate: string) => {
        added.push(candidate);
        return realpathSync(candidate);
      },
      closeWorkspace: async () => undefined,
      dispatch: async () => ({ version: 3 }),
      subscribe: async () => () => undefined,
      setRequestHandler: async () => undefined,
    } as unknown as WorkspaceEngines;
    const collection = await buildZcodeServiceCollection({
      workspacePath: process.cwd(),
      localServices: createBundle(),
      projectCatalog: catalog,
      workspaceEngines: engines,
    });
    registerCleanup(() => collection.dispose());

    const projectService = collection.get(IProjectService);
    const saved = await projectService.saveProject({ roots: [dir] });

    expect(saved.id).toBe(`local:${realpathSync(dir)}`);
    expect(added).toContain(resolve(dir));
    expect(catalog.findByPath(dir)?.path).toBe(realpathSync(dir));

    const tree = await projectService.readTree();
    expect(tree.projects.map((project) => project.id)).toContain(saved.id);
    expect(tree.tasks).toEqual([]);
  });

  it("shares process services but not per-connection OS resources", async () => {
    const bundle = createBundle();
    const first = await buildCollection(process.cwd(), bundle);
    const second = await buildCollection(process.cwd(), bundle);

    expect(second.get(ISettingService)).toBe(first.get(ISettingService));
    expect(second.get(IGitService)).toBe(first.get(IGitService));
    expect(second.get(ITerminalService)).not.toBe(first.get(ITerminalService));
    expect(second.get(IFileWatcherService)).not.toBe(
      first.get(IFileWatcherService),
    );
  });

  it("keeps the stub fallback for services without a real implementation", async () => {
    const bundle = createBundle();
    const collection = await buildCollection(process.cwd(), bundle);
    const checkpoint = collection.get(IGitCheckpointService) as unknown as {
      __stubProbe__(): Promise<unknown>;
    };

    await expect(checkpoint.__stubProbe__()).rejects.toThrow(
      `${ZCODE_UNAVAILABLE_PREFIX}${IGitCheckpointService.channelName}`,
    );
  });

  it("registers engine-backed agent and session services", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const engines = {
      dispatch: async (method: string, params: unknown) => {
        calls.push({ method, params });
        return { version: 3 };
      },
      subscribe: async () => () => undefined,
      setRequestHandler: async () => undefined,
    } as unknown as WorkspaceEngines;
    const collection = await buildZcodeServiceCollection({
      workspacePath: process.cwd(),
      localServices: createBundle(),
      workspaceEngines: engines,
    });
    registerCleanup(() => collection.dispose());

    const agent = collection.get(IZCodeAgentService);
    const hello = await agent.helloConversationV4();
    expect(hello.kind).toBe("hello");
    expect(hello.connectionId.length).toBeGreaterThan(0);

    const session = collection.get(IZCodeSessionService);
    const initialized = await session.initializeWorkspace({
      workspacePath: process.cwd(),
    });
    expect(initialized.available).toBe(true);
    expect(calls).toContainEqual({
      method: "runtime/capabilities",
      params: { workspacePath: process.cwd() },
    });
  });

  it("lists a temporary directory through fileService", async () => {
    const dir = await tempDir("tnt-zcode-file-");
    await writeFile(join(dir, "alpha.txt"), "alpha\n");
    await writeFile(join(dir, "beta.txt"), "beta\n");
    await mkdir(join(dir, "nested"));

    const collection = await buildCollection(dir, createBundle());
    const entries = await collection.get(IFileService).readdir({ path: dir });

    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "alpha.txt",
      "beta.txt",
      "nested",
    ]);
    expect(entries.find((entry) => entry.name === "nested")?.type).toBe(
      "directory",
    );
  });

  it("rejects a file read outside the connection workspace", async () => {
    const workspace = await tempDir("tnt-zcode-inside-");
    const outside = await tempDir("tnt-zcode-outside-");
    await writeFile(join(outside, "secret.txt"), "secret\n");

    const collection = await buildCollection(workspace, createBundle());
    await expect(
      collection.get(IFileService).readdir({ path: outside }),
    ).rejects.toThrow(WORKSPACE_BOUNDARY_PREFIX);
  });

  it("rejects a terminal cwd outside the connection workspace", async () => {
    const workspace = await tempDir("tnt-zcode-term-ws-");
    const outside = await tempDir("tnt-zcode-term-out-");

    const collection = await buildCollection(workspace, createBundle());
    await expect(
      collection.get(ITerminalService).create({
        cols: 80,
        rows: 24,
        cwd: outside,
      }),
    ).rejects.toThrow(`${WORKSPACE_BOUNDARY_PREFIX}terminal cwd`);
  });

  it("summarizes a temporary git repository through gitService", async () => {
    const repo = await tempDir("tnt-zcode-git-");
    await execFileAsync("git", ["init", "-q", repo]);
    await writeFile(join(repo, "tracked.txt"), "hello\n");
    await execFileAsync("git", ["-C", repo, "add", "tracked.txt"]);
    await execFileAsync("git", [
      "-C",
      repo,
      "-c",
      "user.name=TNT Test",
      "-c",
      "user.email=tnt@example.com",
      "commit",
      "-q",
      "-m",
      "initial",
    ]);

    const collection = await buildCollection(repo, createBundle());
    const summary = await collection
      .get(IGitService)
      .getRepositorySummary({ workspacePath: repo });

    // Git reports forward slashes and Windows may hand back an 8.3 short
    // name, so compare the filesystem identity rather than the spelling.
    const canonical = (value: string): string => {
      try {
        return realpathSync.native(resolve(value));
      } catch {
        return resolve(value);
      }
    };
    expect(summary.isRepository).toBe(true);
    expect(canonical(summary.workspacePath)).toBe(canonical(repo));
    expect(canonical(summary.repoRoot)).toBe(canonical(repo));
    expect(typeof summary.branchName).toBe("string");
    expect(summary.branchName?.length).toBeGreaterThan(0);
  });

  it("returns AppSettings from settingService.get", async () => {
    const collection = await buildCollection(process.cwd(), createBundle());
    const settings = await collection.get(ISettingService).get();

    expect(typeof settings).toBe("object");
    expect(Array.isArray(settings.recentProjects)).toBe(true);
    expect(typeof settings.locale).toBe("string");
  });

  it("returns platform info from systemService", async () => {
    const collection = await buildCollection(process.cwd(), createBundle());
    const info = await collection.get(ISystemService).info();

    expect(info.platform).toBe(process.platform);
    expect(typeof info.homedir).toBe("string");
    expect(info.homedir.length).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === "win32")(
    "opens a pty and echoes input through terminalService",
    async (ctx) => {
      const dir = await tempDir("tnt-zcode-pty-");
      const collection = await buildCollection(dir, createBundle());
      const terminal = collection.get(ITerminalService);

      let created: { id: string };
      try {
        created = await terminal.create({ cols: 80, rows: 24, cwd: dir });
      } catch (error) {
        if (isPtyUnavailable(error)) {
          ctx.skip("node-pty is not installed for this runtime");
          return;
        }
        throw error;
      }

      const { id } = created;
      let output = "";
      const subscription = terminal.onDynamicData(id)((chunk) => {
        output += chunk;
      });

      try {
        await terminal.write({ id, data: "echo tnt-pty-ok\r" });
        await waitFor(
          () => output.includes("tnt-pty-ok"),
          "pty echo of tnt-pty-ok",
        );
      } finally {
        subscription.dispose();
        await terminal.dispose({ id });
      }

      expect(output).toContain("tnt-pty-ok");
    },
  );
});
