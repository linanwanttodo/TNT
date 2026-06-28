/*
 * TNT 桥：ZCode shared 包类型与工具的本地替身。
 * 纯函数取自本目录已拷贝的 ZCode shared 源文件；平台/编辑器类型
 * 按 TNT 无桌面平台层的前提给出最小形状。
 */

export {
  decodeMarkdownArtifactImageSource,
  rewriteMarkdownArtifactImageSources,
} from "./markdown-artifact-images.ts";

export {
  getZCodeToolFamilyForName,
  isZCodeFileContentWriteToolName,
  normalizeZCodeToolName,
  type ZCodeKnownToolName,
  type ZCodeToolFamily,
} from "./tool-identity.ts";

export { formatLogPrefix } from "./log-format.ts";

import { MEDIA_PREVIEW_FORMATS } from "./media-preview.ts";
export {
  MEDIA_PREVIEW_FORMATS,
  getMediaPreviewFormat,
} from "./media-preview.ts";
export type { MediaPreviewFormat, MediaPreviewKind } from "./media-preview.ts";

// ---- 最小类型替身 ----

export interface EditorInfo {
  id: string;
  name: string;
  iconDataUrl?: string;
  isDefault?: boolean;
}

export interface FileStat {
  type: "file" | "directory";
  size?: number;
  mtime?: number;
}

export interface RemoteTarget {
  kind?: string;
  id?: string;
}

export type OpenInEditorRemoteTarget = RemoteTarget;

export interface OpenInEditorOptions {
  pathKind?: "file" | "directory";
  remoteTarget?: OpenInEditorRemoteTarget;
  workspaceIdentity?: string;
}

export type FileMediaPreview = {
  url?: string;
  mediaType: string;
  dataBase64: string;
};

export interface IPlatformService {
  canOpenLocalFiles?: boolean;
  openExternal(href: string): void;
  openExternalFile(path: string): void;
  captureWindowScreenshot?(): Promise<unknown>;
  exportLogs(options?: unknown): Promise<{ success?: boolean; error?: string }>;
  executeDesktopCommand?(commandId: string): Promise<unknown>;
  saveFile(input: {
    data?: ArrayBuffer;
    bytes?: Uint8Array;
    suggestedName?: string;
    sourceUrl?: string;
    src?: string;
  }): Promise<{
    success: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
  }>;
  openInEditor(
    editorId: string,
    path: string,
    options?: OpenInEditorOptions,
  ): Promise<{ success: boolean; error?: string }>;
  getInstalledEditors?(): Promise<EditorInfo[]>;
}

export type FeedbackSubmitDraft = {
  severity?: string;
  includeLogs?: boolean;
  description?: string;
  screenshots?: unknown[];
  [key: string]: unknown;
};

export const BROWSER_LOCAL_PREVIEW_SCHEME = "zcode-local-preview";

export function browserPreviewSourceUrl(url: string): string {
  return url.replace(`${BROWSER_LOCAL_PREVIEW_SCHEME}:`, "");
}

export function isTodoPlanToolName(value: string | null | undefined): boolean {
  return (
    value === "todo_write" ||
    value === "todo_read" ||
    value === "todowrite" ||
    value === "todoread"
  );
}

// ---- TaskChat 承重类型替身（taskChatMessageTypes.ts type-only 消费）----

export type ZCodeProvider = {
  id?: string;
  name?: string;
  [key: string]: unknown;
};

export type ZCodeTaskMeta = {
  taskId?: string;
  title?: string;
  forkedFromTaskId?: string;
  updatedAt?: number;
  [key: string]: unknown;
};

export type ZCodeTaskChangeSummary = Record<string, unknown>;

export type GitRepositorySummary = {
  isRepository: boolean;
  headRefType: GitHeadRefType;
  branchName: string | null;
  summary?: string;
  dirtyFileCount?: number;
  [key: string]: unknown;
};

export type UserInfo = {
  id?: string;
  name?: string;
  email?: string;
};

export type GitHeadRefType = "branch" | "tag" | "commit" | "detached";

export type GitFileChange = {
  path: string;
  repoRelativePath: string;
  workspaceRelativePath: string;
  kind: string;
  added: number;
  removed: number;
  status?: string;
  [key: string]: unknown;
};

export type GitBranchMutationIssueCode = string;

export type GitBranchMutationIssue = {
  code?: GitBranchMutationIssueCode;
  message?: string;
  action?: string;
  created?: boolean;
  didChange?: boolean;
  [key: string]: unknown;
};

export type GitBranchMutationResult = {
  success?: boolean;
  issue?: GitBranchMutationIssue;
  action?: string;
  created?: boolean;
  didChange?: boolean;
  [key: string]: unknown;
};

export type WindowTabState = Record<string, unknown>;

export function redactFeedbackText(text: string): string {
  return text;
}

export function parseRemoteWorkspaceIdentity(
  identity?: string,
): { hostId?: string; workspacePath?: string; sourceServerId?: string } | null {
  if (!identity) return null;
  const [hostId, ...rest] = identity.split("::");
  return {
    hostId,
    workspacePath: rest.join("::") || undefined,
    sourceServerId: hostId,
  };
}

export function remoteHostIdFromWorkspaceIdentity(
  identity?: string,
): string | undefined {
  return parseRemoteWorkspaceIdentity(identity)?.hostId;
}

export function buildServerRemoteWorkspaceIdentity(
  hostId: string,
  path: string,
): string {
  return `${hostId}::${path}`;
}

export type ZCodeAssistantMessagePart = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

export type ZCodeAssistantMessageFeedback = string;

export type ZCodePromptAttachment = {
  id?: string;
  name?: string;
  [key: string]: unknown;
};

export type ZCodeTimelineMeta = Record<string, unknown>;

export type ZCodeTaskSnapshotBodyRef = Record<string, unknown>;

export type ZCodeTaskSnapshotToolFieldRef = Record<string, unknown>;

export type ZCodeTaskSnapshotToolSlice = Record<string, unknown>;

// ---- 任务行活动概要类型替身（taskListRowActivity.ts 消费）----

export type PendingInteractionSummary = {
  permissionCount: number;
  userInputCount: number;
  [key: string]: unknown;
};

export type SessionSummary = Record<string, unknown>;

export type SessionWorkflowActivity = Record<string, unknown>;
