import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { IFileWatcherService, ITerminalService } from "@zcode/services";
import type { AppSettings } from "@zcode/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  buildZcodeServiceCollection,
  type ZcodeConnectionCollection,
} from "../serviceCollection.js";

import {
  createConnectionZcodeServices,
  createLocalZcodeServices,
  disposeLocalZcodeServices,
  getLocalZcodeServices,
  ZCODE_SETTING_WRITE_REJECTED_PREFIX,
  type ConnectionZcodeServices,
  type LocalZcodeServices,
} from "./local.js";
import type { DisposableTerminalService } from "./workspaceScope.js";

const cleanups: Array<() => Promise<void> | void> = [];
let previousGlobalDir: string | undefined;
let testGlobalDir: string | undefined;

beforeAll(() => {
  previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  testGlobalDir = mkdtempSync(path.join(tmpdir(), "tnt-zcode-global-"));
  process.env.TNT_GLOBAL_DIR = testGlobalDir;
});

afterAll(() => {
  if (previousGlobalDir === undefined) {
    delete process.env.TNT_GLOBAL_DIR;
  } else {
    process.env.TNT_GLOBAL_DIR = previousGlobalDir;
  }
  if (testGlobalDir) {
    rmSync(testGlobalDir, { recursive: true, force: true });
  }
});

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function createBundle(): LocalZcodeServices {
  const bundle = createLocalZcodeServices();
  cleanups.push(() => bundle.dispose());
  return bundle;
}

interface ResourceState {
  active: number;
  createCalls: number;
  disposeAllCalls: number;
  lastCwd: string | undefined;
}

function fakeTerminal(): {
  service: DisposableTerminalService;
  state: ResourceState;
} {
  const state: ResourceState = {
    active: 0,
    createCalls: 0,
    disposeAllCalls: 0,
    lastCwd: undefined,
  };
  let nextId = 0;
  const idle = { dispose: () => undefined };
  return {
    state,
    service: {
      async create(params) {
        state.createCalls += 1;
        state.lastCwd = params.cwd;
        state.active += 1;
        nextId += 1;
        return {
          id: `pty-${nextId}`,
          shell: "/bin/sh",
          fontFamily: "monospace",
          fontFamilySource: "fallback",
        };
      },
      async write() {},
      async resize() {},
      async dispose() {
        state.active = Math.max(0, state.active - 1);
      },
      onDynamicData: () => () => idle,
      onDynamicExit: () => () => idle,
      disposeAll() {
        state.disposeAllCalls += 1;
        state.active = 0;
      },
    },
  };
}

interface WatcherState {
  active: number;
  watchCalls: number;
  disposeAllCalls: number;
}

function fakeWatcher(): {
  service: IFileWatcherService;
  state: WatcherState;
} {
  const state: WatcherState = {
    active: 0,
    watchCalls: 0,
    disposeAllCalls: 0,
  };
  let nextId = 0;
  const idle = { dispose: () => undefined };
  return {
    state,
    service: {
      async watch() {
        state.watchCalls += 1;
        state.active += 1;
        nextId += 1;
        return { id: `watch-${nextId}` };
      },
      async unwatch() {
        state.active = Math.max(0, state.active - 1);
      },
      disposeAll() {
        state.disposeAllCalls += 1;
        state.active = 0;
      },
      onDynamicChange: () => () => idle,
    },
  };
}

function buildCollection(
  workspacePath: string,
  localServices: LocalZcodeServices,
  connectionServices: ConnectionZcodeServices,
): Promise<ZcodeConnectionCollection> {
  return buildZcodeServiceCollection({
    workspacePath,
    localServices,
    connectionServices,
  });
}

describe("the isolated settings service", () => {
  it("writes its store under the TNT-owned zcode home", async () => {
    const globalHome = await tempDir("tnt-zcode-store-");
    const previous = process.env.TNT_GLOBAL_DIR;
    process.env.TNT_GLOBAL_DIR = globalHome;
    try {
      const bundle = createBundle();
      await bundle.settingService.update({ locale: "en-US" });

      const settingsFile = path.join(
        globalHome,
        "zcode-home",
        ".zcode",
        "v2",
        "setting.json",
      );
      const stored = JSON.parse(await readFile(settingsFile, "utf8")) as {
        locale?: string;
      };
      expect(stored.locale).toBe("en-US");
    } finally {
      if (previous === undefined) {
        delete process.env.TNT_GLOBAL_DIR;
      } else {
        process.env.TNT_GLOBAL_DIR = previous;
      }
    }
  });

  it("allows shell preferences and rejects host-only keys", async () => {
    const bundle = createBundle();

    await bundle.settingService.update({ locale: "en-US" });
    expect((await bundle.settingService.get()).locale).toBe("en-US");

    const rejected: Array<Partial<AppSettings>> = [
      { httpProxy: "http://127.0.0.1:9" },
      { httpProxyNoProxy: "*" },
      { httpProxyCaCertPath: "/tmp/ca.pem" },
      { dataBaseDir: "/tmp/tnt-data" },
      { providerFamilyDomain: "zai" },
    ];
    for (const patch of rejected) {
      await expect(bundle.settingService.update(patch)).rejects.toThrow(
        ZCODE_SETTING_WRITE_REJECTED_PREFIX,
      );
    }

    await expect(
      bundle.settingService.updateDataBaseDir("/tmp/tnt-data"),
    ).rejects.toThrow(`${ZCODE_SETTING_WRITE_REJECTED_PREFIX}dataBaseDir`);
  });
});

describe("the process-wide bundle", () => {
  it("is created once, disposed once, and rebuilt after disposal", () => {
    disposeLocalZcodeServices();
    cleanups.push(() => disposeLocalZcodeServices());

    const first = getLocalZcodeServices();
    expect(getLocalZcodeServices()).toBe(first);

    disposeLocalZcodeServices();
    expect(() => disposeLocalZcodeServices()).not.toThrow();

    const second = getLocalZcodeServices();
    expect(second).not.toBe(first);

    disposeLocalZcodeServices();
  });
});

describe("per-connection services", () => {
  it("exposes the factory's disposeAll without duck typing at the call site", () => {
    const bundle = createBundle();
    const connection = createConnectionZcodeServices({
      workspacePath: process.cwd(),
      settingService: bundle.settingService,
    });
    cleanups.push(() => connection.dispose());

    expect(typeof connection.terminalService.disposeAll).toBe("function");
    expect(typeof connection.fileWatcherService.disposeAll).toBe("function");
  });

  it("leaves zero ptys and watchers after two connections close in turn", async () => {
    const workspace = await tempDir("tnt-zcode-connections-");
    const bundle = createBundle();

    for (let index = 0; index < 2; index += 1) {
      const terminal = fakeTerminal();
      const watcher = fakeWatcher();
      const connection = createConnectionZcodeServices({
        workspacePath: workspace,
        settingService: bundle.settingService,
        terminalService: terminal.service,
        fileWatcherService: watcher.service,
      });
      const collection = await buildCollection(workspace, bundle, connection);

      await collection.get(ITerminalService).create({ cols: 80, rows: 24 });
      await collection.get(IFileWatcherService).watch({ path: workspace });
      expect(terminal.state.active).toBe(1);
      expect(watcher.state.active).toBe(1);

      collection.dispose();
      collection.dispose();

      expect(terminal.state.active).toBe(0);
      expect(watcher.state.active).toBe(0);
      expect(terminal.state.disposeAllCalls).toBe(1);
      expect(watcher.state.disposeAllCalls).toBe(1);
    }
  });
});
