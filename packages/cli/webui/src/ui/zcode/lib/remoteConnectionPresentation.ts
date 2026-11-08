/*
 * TNT 桥：ZCode remoteConnectionPresentation 的本地替身。
 * TNT webui 没有远程连接子系统；展示工具返回本地工作区状态。
 */
export function describeRemoteConnectionState(_state?: unknown): string {
  return "";
}

export function resolveRemoteConnectionBadge(_input?: unknown): null {
  return null;
}

export function formatRemoteDeviceName(
  _target?: unknown,
  _sourceServerDisplayName?: string,
): string | null {
  return null;
}

export function resolveRemoteConnectionPresentation(_input?: unknown): {
  label: string;
  state: string;
  status: string;
  dot: string;
  isConnected: boolean;
  shortMessageId: string;
  recovery: {
    messageId: string;
    values?: Record<string, string | number>;
  } | null;
} {
  return {
    label: "",
    state: "local",
    status: "online",
    dot: "bg-foreground-subtlest",
    isConnected: false,
    shortMessageId: "",
    recovery: null,
  };
}
