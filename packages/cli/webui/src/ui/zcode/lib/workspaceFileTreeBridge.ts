import type { EditorInfo } from "./shared.ts";
/*
 * TNT 桥：ZCode workspace-file-tree/model 的最小替身。
 * TNT webui 没有工作区文件树；相对路径计算退化为纯字符串处理。
 */
export function getWorkspaceFileRelativePath(
  workspacePath: string,
  path: string,
): string {
  const normalizedWorkspace = workspacePath
    .replaceAll("\\", "/")
    .replace(/\/+$/, "");
  const normalizedPath = path.replaceAll("\\", "/");
  if (
    normalizedWorkspace &&
    (normalizedPath === normalizedWorkspace ||
      normalizedPath.startsWith(`${normalizedWorkspace}/`))
  ) {
    return normalizedPath.slice(normalizedWorkspace.length + 1) || ".";
  }
  return normalizedPath;
}

export const workspaceFileTreeHelpers = {};

export function sortInstalledEditorsForFileTree(
  editors: EditorInfo[],
): EditorInfo[] {
  return [...editors];
}

export function normalizeWorkspaceRelativeFilePath(
  path: string,
): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized.length > 0 ? normalized : null;
}
export { getFileManagerLabel } from "./fileMenuBridge.tsx";
