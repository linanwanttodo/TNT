/*
 * TNT 桥：ZCode 平台/工作区服务 hooks 的降级替身。
 * TNT webui 没有桌面平台层与 workspace services；这些 hooks 返回空实现，
 * 让调用点走组件内已有的降级分支（ZCode 原逻辑均判空或容错）。
 */
import { createContext, useContext } from "react";
import type { EditorInfo, FileStat, OpenInEditorOptions } from "./shared.ts";

export interface ZCodePlatformStub {
  canOpenLocalFiles: boolean;
  openExternal(href: string): void;
  openExternalFile(path: string): void;
  openCommunity(): Promise<unknown>;
  executeDesktopCommand(commandId: string): Promise<unknown>;
  getDeviceId(): string;
  captureWindowScreenshot?(): Promise<unknown>;
  exportLogs(options?: unknown): Promise<{ success?: boolean; error?: string }>;
  openInEditor(
    editorId: string,
    path: string,
    options?: OpenInEditorOptions,
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

const noop = () => {};
const noopAsync = async () => ({ success: false as const });
const noopSave = async () => ({
  success: false as const,
  canceled: true as const,
});

const PlatformContext = createContext<ZCodePlatformStub | null | undefined>(
  undefined,
);

export function usePlatform(): ZCodePlatformStub {
  return {
    canOpenLocalFiles: false,
    openExternal: noop,
    openExternalFile: noop,
    openCommunity: async () => ({}),
    executeDesktopCommand: async () => ({}),
    getDeviceId: () => "",
    exportLogs: async () => ({}),
    saveFile: noopSave,
    openInEditor: noopAsync,
    getInstalledEditors: async () => [],
  };
}

export function useOptionalPlatform(): ZCodePlatformStub | undefined {
  const value = useContext(PlatformContext);
  return value ?? undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WorkspaceServicesStub {
  fileService: {
    stat(params: { path: string }): Promise<FileStat>;
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
    }): Promise<Record<string, any>>;
    archiveTask(input: {
      taskId: string;
      workspacePath?: string;
      workspaceIdentity?: string;
    }): Promise<Record<string, any>>;
    setTaskPinned(input: {
      taskId: string;
      workspacePath?: string;
      pinned: boolean;
      workspaceIdentity?: string;
    }): Promise<Record<string, any>>;
    setTaskUnread(input: {
      taskId: string;
      workspacePath?: string;
      workspaceIdentity?: string;
      unread?: boolean;
    }): Promise<Record<string, any>>;
  };
  systemService: {
    info(): Promise<{ homedir: string }>;
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

const servicesStub: WorkspaceServicesStub = {
  fileService: {
    stat: async () => ({ type: "file" }),
    readMediaPreview: async () => ({ mediaType: "image/png", dataBase64: "" }),
  },
  zcodeTaskService: {
    renameTask: async (input) => ({ title: input.title }),
    archiveTask: async () => ({}),
    setTaskPinned: async () => ({}),
    setTaskUnread: async () => ({}),
  },
  systemService: {
    info: async () => ({ homedir: "" }),
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
