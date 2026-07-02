import type {
  IBroadcastService,
  IFileService,
  IFileWatcherService,
  IGitService,
  ISettingService,
  ISystemService,
  ITerminalService,
} from "@zcode/services";
import {
  createBroadcastService,
  createFileService,
  createFileWatcherService,
  createGitService,
  createSettingService,
  createSystemService,
  createTerminalService,
} from "@zcode/services/node";

interface DisposableAll {
  disposeAll(): void;
}

function hasDisposeAll(service: unknown): service is DisposableAll {
  return (
    typeof (service as { disposeAll?: unknown } | null)?.disposeAll ===
    "function"
  );
}

/**
 * The real, engine-independent ZCode services the web shell can serve.
 *
 * A bundle owns OS-level state (the file watcher and the pty registry), so it
 * lives once per host process and every connection's ServiceCollection points
 * at the same instances. The workspace is not captured here: fileService and
 * gitService take the root on each call, and terminalService takes a cwd on
 * `create`.
 */
export interface LocalZcodeServices {
  readonly fileService: IFileService;
  readonly gitService: IGitService;
  readonly settingService: ISettingService;
  readonly systemService: ISystemService;
  readonly terminalService: ITerminalService;
  readonly fileWatcherService: IFileWatcherService;
  readonly broadcastService: IBroadcastService;
  dispose(): void;
}

export function createLocalZcodeServices(): LocalZcodeServices {
  const settingService = createSettingService();
  const terminalService = createTerminalService({ settingService });
  const fileWatcherService = createFileWatcherService();
  const fileService = createFileService();
  const gitService = createGitService();
  const systemService = createSystemService();
  const broadcastService = createBroadcastService(null);
  let disposed = false;

  return {
    fileService,
    gitService,
    settingService,
    systemService,
    terminalService,
    fileWatcherService,
    broadcastService,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // The interfaces do not expose their teardown, but the node factories
      // implement disposeAll to kill ptys and close fs.watch handles.
      if (hasDisposeAll(terminalService)) terminalService.disposeAll();
      if (hasDisposeAll(fileWatcherService)) fileWatcherService.disposeAll();
    },
  };
}

let processLocalServices: LocalZcodeServices | null = null;

export function getLocalZcodeServices(): LocalZcodeServices {
  processLocalServices ??= createLocalZcodeServices();
  return processLocalServices;
}

/** Releases the process-wide bundle; the next accessor call builds a fresh one. */
export function disposeLocalZcodeServices(): void {
  const services = processLocalServices;
  processLocalServices = null;
  services?.dispose();
}
