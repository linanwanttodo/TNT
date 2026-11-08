import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  IBroadcastService,
  IFileService,
  IFileWatcherService,
  IGitCheckpointService,
  IGitService,
  ISettingService,
  ISystemService,
  ITerminalService,
  type ServiceCollection,
} from "@zcode/services";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildZcodeServiceCollection,
  ZCODE_LOCAL_SERVICE_DESCRIPTORS,
} from "./serviceCollection.js";
import {
  createLocalZcodeServices,
  type LocalZcodeServices,
} from "./services/local.js";
import { ZCODE_UNAVAILABLE_PREFIX } from "./services/stubs.js";

const execFileAsync = promisify(execFile);

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

function registerCleanup(cleanup: () => Promise<void> | void): void {
  cleanups.push(cleanup);
}

function createBundle(): LocalZcodeServices {
  const bundle = createLocalZcodeServices();
  registerCleanup(() => bundle.dispose());
  return bundle;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  registerCleanup(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function buildCollection(
  workspacePath: string,
  localServices: LocalZcodeServices,
): ServiceCollection {
  return buildZcodeServiceCollection({ workspacePath, localServices });
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

describe("buildZcodeServiceCollection", () => {
  it("registers a real instance for every local channel", () => {
    const bundle = createBundle();
    const collection = buildCollection(process.cwd(), bundle);

    expect(collection.get(IFileService)).toBe(bundle.fileService);
    expect(collection.get(IGitService)).toBe(bundle.gitService);
    expect(collection.get(ISettingService)).toBe(bundle.settingService);
    expect(collection.get(ISystemService)).toBe(bundle.systemService);
    expect(collection.get(ITerminalService)).toBe(bundle.terminalService);
    expect(collection.get(IFileWatcherService)).toBe(bundle.fileWatcherService);
    expect(collection.get(IBroadcastService)).toBe(bundle.broadcastService);

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
      ]),
    );
  });

  it("shares the process bundle across connection collections", () => {
    const bundle = createBundle();
    const first = buildCollection(process.cwd(), bundle);
    const second = buildCollection(process.cwd(), bundle);

    expect(second.get(IFileService)).toBe(first.get(IFileService));
    expect(second.get(ITerminalService)).toBe(first.get(ITerminalService));
  });

  it("keeps the stub fallback for services without a real implementation", async () => {
    const bundle = createBundle();
    const collection = buildCollection(process.cwd(), bundle);
    const checkpoint = collection.get(IGitCheckpointService) as unknown as {
      __stubProbe__(): Promise<unknown>;
    };

    await expect(checkpoint.__stubProbe__()).rejects.toThrow(
      `${ZCODE_UNAVAILABLE_PREFIX}${IGitCheckpointService.channelName}`,
    );
  });

  it("lists a temporary directory through fileService", async () => {
    const dir = await tempDir("tnt-zcode-file-");
    await writeFile(join(dir, "alpha.txt"), "alpha\n");
    await writeFile(join(dir, "beta.txt"), "beta\n");
    await mkdir(join(dir, "nested"));

    const collection = buildCollection(dir, createBundle());
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

    const collection = buildCollection(repo, createBundle());
    const summary = await collection
      .get(IGitService)
      .getRepositorySummary({ workspacePath: repo });

    expect(summary.isRepository).toBe(true);
    expect(summary.workspacePath).toBe(repo);
    expect(summary.repoRoot).toBe(repo);
    expect(typeof summary.branchName).toBe("string");
    expect(summary.branchName?.length).toBeGreaterThan(0);
  });

  it("returns AppSettings from settingService.get", async () => {
    const collection = buildCollection(process.cwd(), createBundle());
    const settings = await collection.get(ISettingService).get();

    expect(typeof settings).toBe("object");
    expect(Array.isArray(settings.recentProjects)).toBe(true);
    expect(typeof settings.locale).toBe("string");
  });

  it("returns platform info from systemService", async () => {
    const collection = buildCollection(process.cwd(), createBundle());
    const info = await collection.get(ISystemService).info();

    expect(info.platform).toBe(process.platform);
    expect(typeof info.homedir).toBe("string");
    expect(info.homedir.length).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === "win32")(
    "opens a pty and echoes input through terminalService",
    async (ctx) => {
      const dir = await tempDir("tnt-zcode-pty-");
      const collection = buildCollection(dir, createBundle());
      const terminal = collection.get(ITerminalService);

      let created: { id: string };
      try {
        created = await terminal.create({ cols: 80, rows: 24, cwd: dir });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("node-pty is unavailable")) {
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
