/*
 * TNT 桥：ZCode workspaceServiceResolver 的本地替身。
 * TNT webui 没有远程工作区服务；远程会话 ID 解析恒为空。
 */
export function resolveWorkspaceRemoteSessionId(
  _scope?:
    | string
    | {
        workspacePath?: string;
        workspaceIdentity?: string;
        remoteSessionId?: string;
        remoteTarget?: unknown;
      },
  _state?: unknown,
): string | undefined {
  return undefined;
}
