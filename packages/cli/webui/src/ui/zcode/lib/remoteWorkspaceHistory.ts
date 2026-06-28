/*
 * TNT 桥：ZCode remoteWorkspaceHistory 的本地替身。
 * TNT webui 没有远程工作区历史；只保留顶栏需要的展示格式化函数。
 */
export function formatRemoteWorkspaceDisplayLabel(
  projectName?: string | null,
  _remoteTarget?: unknown,
): string {
  return projectName ?? "";
}

export function formatRemoteWorkspaceHeaderHostLabel(
  _remoteTarget?: unknown,
): string {
  return "";
}
