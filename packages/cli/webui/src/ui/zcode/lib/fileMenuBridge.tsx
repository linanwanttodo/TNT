/*
 * TNT 桥：ZCode file-menu 子系统的降级替身。
 * TNT webui 没有“用第三方应用打开文件”的文件菜单子系统；
 * FileApplicationChoices/FileSaveAsMenuItem 渲染为空，useFileApplications 走不可用分支。
 */
import { useCallback, type ComponentProps } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function FileApplicationChoices(_props: any) {
  return null;
}

export function FileSaveAsMenuItem(_props: any) {
  return null;
}

export function getFileManagerLabel(..._args: unknown[]): string {
  return "";
}

export function useFileApplications(
  _input: { path: string; pathKind?: string; workspaceIdentity?: string },
  _isRemote?: boolean,
): {
  apps: Array<{
    id: string;
    name: string;
    iconDataUrl?: string;
    isDefault?: boolean;
  }>;
  load: () => Promise<void>;
  open: (app: { id: string; isDefault?: boolean }) => Promise<void>;
  openDefault: () => Promise<void>;
} {
  const noop = useCallback(async () => {}, []);
  return { apps: [], load: noop, open: noop, openDefault: noop };
}
