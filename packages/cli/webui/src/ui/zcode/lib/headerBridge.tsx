/*
 * TNT 桥：ZCode 顶栏（WorkspaceHeader）链的 store/平台钩子替身。
 * TNT webui 没有远程工作区、data-sync 与 ZCode 全局 store 层；
 * 相关 hooks 返回空值，让顶栏走“本地工作区”分支。
 * 带选择器的钩子按 zustand 用法签名：hook((state) => ...)。
 */
import { createContext, useCallback, useContext, type DragEvent } from "react";
import type { EditorInfo } from "./shared.ts";

export type { EditorInfo, RemoteTarget } from "./shared.ts";

function selectorizeUnused(): void {}

/* eslint-disable @typescript-eslint/no-explicit-any */
function hookWithSelector<St extends object>(state: St) {
  const hook = <Sel = St,>(selector?: (state: St) => Sel): Sel =>
    selector ? selector(state) : (state as unknown as Sel);
  return Object.assign(hook, {
    getState: (): St => state,
  });
}

const noop = () => {};
const noopAsync = async () => ({ success: false as const });
const noopSave = async () => ({
  success: false as const,
  canceled: true as const,
});

const PlatformContext = createContext<ZCodePlatformStub | null | undefined>(
  undefined,
);

export interface ZCodePlatformStub {
  canOpenLocalFiles: boolean;
  openExternal(href: string): void;
  openExternalFile(path: string): void;
  openCommunity(): Promise<unknown>;
  executeDesktopCommand(commandId: string): Promise<unknown>;
  getDeviceId?(): string;
  captureWindowScreenshot?(): Promise<unknown>;
  exportLogs?(
    options?: unknown,
  ): Promise<{ success?: boolean; error?: string }>;
  openInEditor(
    editorId: string,
    path: string,
    options?: import("./shared.ts").OpenInEditorOptions,
  ): Promise<{ success: boolean; error?: string }>;
  saveFile(input: {
    data?: ArrayBuffer;
    bytes?: Uint8Array;
    suggestedName?: string;
    src?: string;
  }): Promise<{
    success: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
  }>;
  getInstalledEditors(): Promise<EditorInfo[]>;
}

export const DesktopCommandIds = {
  openSettings: "open-settings",
  openLogs: "open-logs",
  checkForUpdates: "check-for-updates",
  reportVulnerability: "report-vulnerability",
  OpenResourceManager: "open-resource-manager",
  ShowAbout: "show-about",
} as const;

export function usePlatform(): ZCodePlatformStub {
  return {
    canOpenLocalFiles: false,
    openExternal: noop,
    openExternalFile: noop,
    openCommunity: async () => ({}),
    executeDesktopCommand: async () => ({}),
    getDeviceId: () => "",
    openInEditor: noopAsync,
    saveFile: noopSave,
    getInstalledEditors: async () => [],
  };
}

export function useOptionalPlatform(): ZCodePlatformStub | undefined {
  const value = useContext(PlatformContext);
  return value ?? undefined;
}

export interface WorkspaceServicesStub {
  fileService: {
    stat(params: { path: string }): Promise<{ type: "file" | "directory" }>;
    readMediaPreview(params: {
      path: string;
    }): Promise<{ url?: string; mediaType: string; dataBase64: string }>;
  };
  zcodeTaskService: {
    renameTask(input: {
      taskId: string;
      workspacePath?: string;
      title: string;
      workspaceIdentity?: string;
    }): Promise<unknown>;
    archiveTask(input: {
      taskId: string;
      workspacePath?: string;
      workspaceIdentity?: string;
    }): Promise<unknown>;
  };
}

const servicesStub: WorkspaceServicesStub = {
  fileService: {
    stat: async () => ({ type: "file" }),
    readMediaPreview: async () => ({ mediaType: "image/png", dataBase64: "" }),
  },
  zcodeTaskService: {
    renameTask: async (input: { title?: string }) => ({ title: input.title }),
    archiveTask: async () => ({}),
  },
};

export function useOptionalServices(): WorkspaceServicesStub | null {
  return servicesStub;
}

export function useWorkspaceServices(
  _workspacePath?: string,
  _workspaceRemoteSessionId?: string,
  _workspaceIdentity?: string,
): WorkspaceServicesStub {
  return servicesStub;
}

export function useWorkspaceOpenInEditorTarget(_options: {
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
}): {
  isRemoteWorkspace: boolean;
  remoteTarget?: import("./shared.ts").RemoteTarget;
} {
  return { isRemoteWorkspace: false };
}

export function useFileContextActions(_options: {
  canOpenLocalFileManager?: boolean;
  isRemoteWorkspace?: boolean;
  remoteTarget?: import("./shared.ts").RemoteTarget;
  workspaceIdentity?: string;
}): {
  canRevealInFileManager(input: { path: string }): boolean;
  revealFileInFileManager(input: {
    path: string;
    kind: "file" | "directory";
  }): Promise<void>;
  copyAbsolutePath(input: { path: string }): Promise<void>;
  copyRelativePath(input: {
    path: string;
    relativePath?: string;
  }): Promise<void>;
} {
  const noopVoid = async () => {};
  return {
    canRevealInFileManager: () => false,
    revealFileInFileManager: noopVoid,
    copyAbsolutePath: noopVoid,
    copyRelativePath: noopVoid,
  };
}

export function useZCodeStore(): Record<string, unknown> {
  return {};
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function useSessionRuntimeRestart(
  _workspacePath?: string | null,
  _sessionId?: string | null,
  _remoteSessionId?: string | null,
  _workspaceIdentity?: string | null,
): { restart: () => Promise<void>; restartPending: boolean; pending: boolean } {
  const restart = useCallback(async () => {}, []);
  return { restart, restartPending: false, pending: false as const };
}

export function useOptionalProjectDirectory(): {
  directory: { hosts: Array<{ id: string; target?: unknown }> };
} | null {
  return null;
}

export function useRemoteProjectPresentationFacts(_identity?: string): {
  isRemote: boolean;
  remoteLabel?: string;
} {
  return { isRemote: false };
}

export const useRemoteWorkspaceSessionStore = hookWithSelector({
  sessionsById: {} as Record<string, { services?: unknown }>,
});

export function useConfirmDialog(): {
  (options?: {
    title?: string;
    message?: string;
    description?: string;
    confirmLabel?: string;
  }): Promise<boolean>;
  dialog: null;
} {
  const confirm = Object.assign(
    async (_options?: {
      title?: string;
      message?: string;
      description?: string;
      confirmLabel?: string;
    }) => false,
    { dialog: null },
  );
  return confirm as ReturnType<typeof useConfirmDialog>;
}

export function useGlobalTaskList(..._args: unknown[]): {
  items: Array<{ taskId: string; [key: string]: unknown }>;
  loading: boolean;
  refresh: () => void;
} {
  return { items: [], loading: false, refresh: () => {} };
}

export function useTaskListItemContextActions(_input?: unknown): {
  taskSessionFile: { path: string | null; loading: boolean; exists: boolean };
  taskNativeSessionLogFile: {
    provider: string;
    path: string;
    exists: boolean;
    loading: boolean;
  };
  providerConfigFile: { path: string; exists: boolean; loading: boolean };
  fileManagerLabel: string;
  handleCopyText: (title: string, text: string | null | undefined) => void;
  handleOpenTaskPathInFileManager: () => void;
  handleOpenProviderConfig: () => void;
} {
  return {
    taskSessionFile: { path: "", loading: false, exists: false },
    taskNativeSessionLogFile: {
      provider: "",
      path: "",
      exists: false,
      loading: false,
    },
    providerConfigFile: { path: "", exists: false, loading: false },
    fileManagerLabel: "",
    handleCopyText: () => {},
    handleOpenTaskPathInFileManager: () => {},
    handleOpenProviderConfig: () => {},
  };
}

export const useFeedbackStore = hookWithSelector({
  openSubmit: (_input?: unknown) => {},
  openFeatureRequest: (_input?: unknown) => {},
});

export const useModelTrajectoryStore = hookWithSelector({
  requestOpen: (_input?: unknown) => {},
});

export const useZCodeSessionStore = hookWithSelector({
  removeTaskState: (
    _workspacePath?: string,
    _taskId?: string,
    _workspaceIdentity?: string,
  ) => {},
  upsertOptimisticTaskListItem: (
    _workspacePath?: string,
    _task?: unknown,
    _workspaceIdentity?: string,
  ) => {},
  removeOptimisticTaskListItem: (
    _workspacePath?: string,
    _taskId?: string,
    _workspaceIdentity?: string,
  ) => {},
  setTaskUnreadIndicator: (
    _workspacePath?: string,
    _taskId?: string,
    _unread?: boolean,
    _workspaceIdentity?: string,
  ) => {},
});

export function applyTaskQueryCacheMutation(_mutation?: {
  previousTask?: unknown;
  nextTask?: unknown;
  previousState?: { pinned?: boolean; archived?: boolean };
  nextState?: { pinned?: boolean; archived?: boolean };
}): void {}

export function useSourceServerDisplayNames(): Map<string, string> {
  return new Map();
}

export function useRemoteDevicePresentationInput(_sourceServerId?: string): {
  deviceName?: string;
  [key: string]: unknown;
} {
  return {};
}

export function RemoteConnectionStateIcon(_props: Record<string, unknown>) {
  return null;
}

export type ConversationDropTargetController = {
  active?: boolean;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
} | null;

/* eslint-enable @typescript-eslint/no-explicit-any */

export const TID_WORKSPACE_HEADER = "workspace-header";
export const TID_WORKSPACE_HEADER_TITLE = "workspace-header-title";
export const TID_WORKSPACE_HEADER_CONTEXT_PATH =
  "workspace-header-context-path";
export const TID_WORKSPACE_HEADER_ACTIONS = "workspace-header-actions";
export const TID_WORKSPACE_MORE_BUTTON = "workspace-more-button";
export const TID_WORKSPACE_PATH = "workspace-path";
export const TID_WORKSPACE_TITLE = "workspace-title";
export const TID_SIDE_PANE_TOGGLE = "side-pane-toggle";
export const TID_TERMINAL_TOGGLE = "terminal-toggle";
export const TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER =
  "help-menu-resource-manager";
export const TID_WORKSPACE_HELP_MENU_TRIGGER = "help-menu-trigger";

export function useDesktopUpdateMenu(_isDesktop?: boolean): {
  hasUpdateReady: boolean;
  visible: boolean;
  disabled: boolean;
  labelId: string;
  labelValues?: Record<string, string | number>;
  checkForUpdates: (event?: Event | boolean) => void;
} {
  return {
    hasUpdateReady: false,
    visible: false,
    disabled: false,
    labelId: "",
    checkForUpdates: () => {},
  };
}

export function useVulnerabilityReportUrl(_open?: boolean): {
  url: string | null;
  loading: boolean;
} {
  return { url: null, loading: false };
}

export type { FeedbackSubmitDraft } from "./shared.ts";

export function useIsOfficeMode(): boolean {
  return false;
}

export function createOpenInEditorRemoteTarget(
  _remoteTarget?: unknown,
): Record<string, unknown> | undefined {
  return undefined;
}

interface ConversationShareSelectionState {
  openShare: (taskId: string) => void;
  closeShare: (taskId: string) => void;
  publishing: boolean;
  drafts: Record<string, { open?: boolean }>;
  dockStates: Record<
    string,
    { publishing?: boolean; open?: boolean } | undefined
  >;
}

const shareSelectionState: ConversationShareSelectionState = {
  openShare: () => {},
  closeShare: () => {},
  publishing: false,
  drafts: {},
  dockStates: {},
};

export const useConversationShareSelectionStore =
  hookWithSelector(shareSelectionState);

export function DataSyncEntryMenuItems(_props?: {
  disabled?: boolean;
  onSelect?: (category: string) => void;
}) {
  return null;
}

export function resolveDataSyncEntrySourceServerId(
  _input?: unknown,
): string | undefined {
  return undefined;
}

export function useDataSyncDeviceOnline(_sourceServerId?: string): boolean {
  return false;
}

export const useDataSyncEntry = hookWithSelector({
  available: false,
  dialog: null,
  open: (_input?: {
    sourceServerId?: string;
    category?: string;
    workspace?: unknown;
  }) => {},
});

export function useShortcutBindings(_bindings?: unknown): void {}

export function useShortcutCommandLabel(_commandId?: string): string {
  return "";
}

export const userActionTelemetry = {
  record: (_event?: string, _payload?: unknown) => {},
};

export function runUserAction(_action?: unknown): void {}
