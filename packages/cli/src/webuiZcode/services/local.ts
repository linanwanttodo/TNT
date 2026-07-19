import { join } from "node:path";

import type {
  IBroadcastService,
  IFileService,
  IFileWatcherService,
  IGitService,
  IPluginManagementService,
  IPluginsService,
  ISettingService,
  ISettingsSyncService,
  ISystemService,
} from "@zcode/services";
import {
  createBroadcastService,
  createFileService,
  createFileWatcherService,
  createGitService,
  createSettingService,
  createSettingsSyncService,
  createSystemService,
  createTerminalService,
} from "@zcode/services/node";
import type { AppSettings } from "@zcode/shared";

import { globalDir } from "../../config/globalDir.js";
import { isMemoryEnabled, setMemoryEnabled } from "../../utils/memoryState.js";

import { createZcodePluginServices } from "./plugins.js";
import {
  createWorkspaceScopedTerminalService,
  type DisposableTerminalService,
  type WorkspaceRoots,
} from "./workspaceScope.js";

/** Stable prefix so callers and tests can identify a rejected settings write. */
export const ZCODE_SETTING_WRITE_REJECTED_PREFIX =
  "ZCODE_SETTING_WRITE_REJECTED:";

/**
 * The AppSettings keys the browser shell may write.
 *
 * Everything here is a presentation or workspace preference the shell paints
 * from. Deliberately absent: proxy/CA settings, the data directory, desktop
 * window/updater state, and provider/connection profiles. Those belong to the
 * host operator, and a token holder must not be able to redirect the CLI's
 * network or storage.
 */
export const WEB_SHELL_SETTING_UPDATE_KEYS: readonly (keyof AppSettings)[] = [
  "recentProjects",
  "locale",
  "localePreference",
  "terminalInheritSystemProfile",
  "terminalFontFamily",
  "integratedTerminalShell",
  "taskAutoArchiveEnabled",
  "taskAutoArchiveOlderThanDays",
  "keepAwakeWhileRunning",
  "messageStreamShowReasoning",
  "messageStreamShowTodos",
  "toolGroupingExploreEnabled",
  "toolGroupingTerminalEnabled",
  "toolGroupingChangesEnabled",
  "zcodeInteractionBehavior",
  "askUserQuestionAutoResolutionEnabled",
  "modelIoFullRetentionEnabled",
  "dynamicWorkflowMode",
  "enabledBuiltinAgentCliProviders",
  "startPlanRecommendationDismissed",
  "nativeSearchEnhancementsEnabled",
  "toolSearchMode",
  "proactiveSuggestionsEnabled",
  "memoryEnabled",
  "onboardingOccupation",
  "settingsSyncFirstRunPromptHandled",
  "lastWorkspaceSession",
  "lastActiveWorkspace",
  "lastActiveTabIndex",
  "computerUseComposerEntryHidden",
];

const WEB_SHELL_SETTING_UPDATE_KEY_SET = new Set<string>(
  WEB_SHELL_SETTING_UPDATE_KEYS,
);

/**
 * The web shell's view of the vendored settings service.
 *
 * `update` accepts only {@link WEB_SHELL_SETTING_UPDATE_KEYS}; every other key
 * is rejected before the vendored schema runs. `updateDataBaseDir` would move
 * the whole data root, so it is rejected outright. `getUserInstructions` and
 * `saveUserInstructions` stay available: they target the agent's own
 * `~/.zcode/AGENTS.md`, which is separate from the settings store.
 */
export function createWebShellSettingService(
  base: ISettingService,
): ISettingService {
  return {
    get: async () => ({
      ...(await base.get()),
      // The engine's own switch, so the page shows the state the system
      // prompt actually reads rather than a shell-local copy.
      memoryEnabled: isMemoryEnabled(),
    }),
    async update(patch, expectedAccountSettings) {
      const rejected = Object.keys(patch).filter(
        (key) => !WEB_SHELL_SETTING_UPDATE_KEY_SET.has(key),
      );
      if (rejected.length > 0) {
        throw new Error(
          `${ZCODE_SETTING_WRITE_REJECTED_PREFIX}${rejected.join(",")}`,
        );
      }
      if (typeof patch.memoryEnabled === "boolean") {
        setMemoryEnabled(patch.memoryEnabled);
      }
      const enginePatch = { ...patch } as Record<string, unknown>;
      delete enginePatch.memoryEnabled;
      return base.update(
        enginePatch as Parameters<ISettingService["update"]>[0],
        expectedAccountSettings,
      );
    },
    async updateDataBaseDir() {
      throw new Error(`${ZCODE_SETTING_WRITE_REJECTED_PREFIX}dataBaseDir`);
    },
    getUserInstructions: () => base.getUserInstructions(),
    saveUserInstructions: (content) => base.saveUserInstructions(content),
  };
}

export interface CreateLocalZcodeServicesOptions {
  /**
   * Root the vendored settings service derives its store from. Defaults to
   * `<TNT_GLOBAL_DIR>/zcode-home`, never the host's own `~/.zcode`.
   */
  settingHomeDir?: string;
}

/**
 * The real, engine-independent ZCode services that are safe to share across
 * every connection: none of them owns a pty or an fs.watch handle. The
 * per-connection resources live in {@link ConnectionZcodeServices}.
 */
export interface LocalZcodeServices {
  readonly fileService: IFileService;
  readonly gitService: IGitService;
  readonly settingService: ISettingService;
  readonly systemService: ISystemService;
  readonly broadcastService: IBroadcastService;
  readonly pluginsService: IPluginsService;
  readonly pluginManagementService: IPluginManagementService;
  readonly settingsSyncService: ISettingsSyncService;
  dispose(): void;
}

/**
 * A connection owns the OS-level resources its tab creates, so a reload or a
 * second tab cannot inherit the first tab's ptys or watchers.
 */
export interface ConnectionZcodeServices {
  readonly terminalService: DisposableTerminalService;
  readonly fileWatcherService: IFileWatcherService;
  dispose(): void;
}

export interface CreateConnectionZcodeServicesOptions {
  workspacePath: string;
  /** Allowed roots; defaults to the connection's primary workspace. */
  workspaceRoots?: WorkspaceRoots;
  settingService: ISettingService;
  /** Test seam; the default is the vendored node factory. */
  terminalService?: DisposableTerminalService;
  /** Test seam; the default is the vendored node factory. */
  fileWatcherService?: IFileWatcherService;
}

function createIsolatedSettingService(homeDir: string): ISettingService {
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = homeDir;
  try {
    return createSettingService();
  } finally {
    if (previous === undefined) {
      delete process.env.ZCODE_DESKTOP_HOME_DIR;
    } else {
      process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    }
  }
}

export function createLocalZcodeServices(
  options: CreateLocalZcodeServicesOptions = {},
): LocalZcodeServices {
  const settingHomeDir =
    options.settingHomeDir ?? join(globalDir(), "zcode-home");
  const settingService = createWebShellSettingService(
    createIsolatedSettingService(settingHomeDir),
  );
  const fileService = createFileService();
  const gitService = createGitService();
  const systemService = createSystemService();
  const broadcastService = createBroadcastService(null);
  const pluginServices = createZcodePluginServices();
  const settingsSyncService = createSettingsSyncService({ settingService });
  let disposed = false;

  return {
    fileService,
    gitService,
    settingService,
    systemService,
    broadcastService,
    pluginsService: pluginServices.pluginsService,
    pluginManagementService: pluginServices.pluginManagementService,
    settingsSyncService,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pluginServices.dispose();
    },
  };
}

export function createConnectionZcodeServices(
  options: CreateConnectionZcodeServicesOptions,
): ConnectionZcodeServices {
  const baseTerminal =
    options.terminalService ??
    (createTerminalService({
      settingService: options.settingService,
    }) as DisposableTerminalService);
  const terminalService = createWorkspaceScopedTerminalService(
    baseTerminal,
    options.workspaceRoots ?? options.workspacePath,
  );
  const fileWatcherService =
    options.fileWatcherService ?? createFileWatcherService();
  let disposed = false;

  return {
    terminalService,
    fileWatcherService,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      terminalService.disposeAll();
      fileWatcherService.disposeAll();
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
