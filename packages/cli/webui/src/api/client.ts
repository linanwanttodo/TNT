/**
 * The webui's transport to the in-process server: SSE for engine events,
 * JSON POSTs for user actions. Paths are root-relative; vite's dev proxy and
 * the static route both mount the app under /app, so the API stays at the
 * server origin root.
 */
import type {
  AgentEvent,
  AgentEventType,
  StateSnapshot,
} from "../types/agent-events.js";

export type ConnStatus = "live" | "reconnecting" | "offline";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

/**
 * The server writes each event as a named SSE event (`event: <type>`), so a
 * listener must be registered per type; the default "message" event never
 * fires for named events.
 */
const EVENT_TYPES = [
  "turn.started",
  "content.delta",
  "reasoning.delta",
  "tool.started",
  "tool.updated",
  "tool.finished",
  "permission.requested",
  "question.requested",
  "notice",
  "compaction.started",
  "compaction.finished",
  "turn.completed",
  "turn.failed",
  "turn.interrupted",
  "queue.changed",
  "session.changed",
  "model.changed",
  "workspace.changed",
] as const satisfies readonly AgentEventType[];

/**
 * Subscribe to GET /events. Reconnects with exponential backoff (1s, 2s, 4s,
 * ... capped at 10s); onStatus drives the disconnect banner.
 * @returns Close function: stops the stream and cancels any pending retry.
 */
export function connectEvents(
  onEvent: (event: AgentEvent) => void,
  onStatus: (status: ConnStatus) => void,
): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let delay = RECONNECT_BASE_MS;

  const open = () => {
    if (closed) return;
    source = new EventSource("/events");
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (ev) => {
        try {
          onEvent(JSON.parse((ev as MessageEvent).data) as AgentEvent);
        } catch {
          // A malformed line is one lost event, not a dropped stream.
        }
      });
    }
    source.onerror = () => {
      if (closed) return;
      source?.close();
      source = null;
      onStatus("reconnecting");
      retryTimer = setTimeout(() => {
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        open();
      }, delay);
    };
    source.onopen = () => {
      delay = RECONNECT_BASE_MS;
      onStatus("live");
    };
  };

  open();

  return () => {
    closed = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    source?.close();
  };
}

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
}

export async function fetchState(): Promise<StateSnapshot> {
  const res = await fetch("/state");
  if (!res.ok) {
    throw new Error(`GET /state failed: ${res.status}`);
  }
  return (await res.json()) as StateSnapshot;
}

/** Every mode the status-bar dropdown offers; mirrors the server's table. */
export const PERMISSION_MODES = [
  "auto",
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "dontAsk",
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/**
 * One dropdown entry: the mode, its label and the one-line description the
 * reference menu shows under each label.
 */
export interface PermissionModeOption {
  mode: PermissionMode;
  label: string;
  description: string;
}

/** Labels and descriptions copied from the desktop reference menu. */
export const PERMISSION_MODE_OPTIONS: readonly PermissionModeOption[] = [
  {
    mode: "auto",
    label: "Auto",
    description: "Claude can modify or delete files without asking",
  },
  {
    mode: "default",
    label: "Manual",
    description: "Always ask before making changes",
  },
  {
    mode: "acceptEdits",
    label: "Accept edits",
    description: "Automatically accept all file edits",
  },
  {
    mode: "plan",
    label: "Plan",
    description: "Create a plan before making changes",
  },
  {
    mode: "bypassPermissions",
    label: "Bypass permissions",
    description: "Claude can modify or delete files without asking",
  },
];

/**
 * Switch the session's permission mode.
 * @returns the mode the server now reports.
 */
export async function setPermissionMode(
  mode: PermissionMode,
): Promise<PermissionMode> {
  const res = await fetch("/permission-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error(`POST /permission-mode failed: ${res.status}`);
  }
  const body = (await res.json()) as { permissionMode: PermissionMode };
  return body.permissionMode;
}

/** One conversation as the sidebar list renders it. */
export interface SessionSummary {
  sessionId: string;
  title: string;
  workspaceDirectory: string;
  dateCreated: string;
  updatedAt?: string | undefined;
}

/**
 * The conversations the sidebar lists, newest first.
 * @returns the summaries the server reports.
 */
export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/sessions");
  if (!res.ok) {
    throw new Error(`GET /sessions failed: ${res.status}`);
  }
  const body = (await res.json()) as { sessions: SessionSummary[] };
  return body.sessions;
}

export async function sendMessage(text: string): Promise<void> {
  await post("/message", { message: text });
}

export async function approve(
  requestId: string,
  approved: boolean,
): Promise<void> {
  await post("/permission", { requestId, approved });
}

export async function stopTurn(): Promise<void> {
  await post("/pause");
}

/**
 * Start a fresh conversation in the server process.
 * @returns the snapshot to hydrate from; the response carries the new
 * session's (empty) history, so no second GET /state is needed.
 */
export async function startSession(): Promise<StateSnapshot> {
  const res = await fetch("/session/new", { method: "POST" });
  if (!res.ok) {
    throw new Error(`POST /session/new failed: ${res.status}`);
  }
  return (await res.json()) as StateSnapshot;
}

/**
 * Switch the server process to a saved conversation.
 * @returns the snapshot carrying the selected session's history.
 */
export async function switchSession(sessionId: string): Promise<StateSnapshot> {
  const res = await fetch("/session/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    throw new Error(`POST /session/select failed: ${res.status}`);
  }
  return (await res.json()) as StateSnapshot;
}

/** One chat model the server offers, mirroring modelCatalog's shape. */
export interface ChatModelOption {
  index: number;
  name: string;
  provider: string;
  current: boolean;
}

/** One checkout of the repository, mirroring the CLI's WorktreeInfo. */
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  detached: boolean;
  bare: boolean;
}

/** GET /models: the available models and the one in use. */
export interface ModelsResponse {
  available: boolean;
  models: ChatModelOption[];
  current: ChatModelOption | null;
}

/** GET /worktrees: the checkouts, the one in use, and whether a move is allowed. */
export interface WorktreesResponse {
  available: boolean;
  worktrees: WorktreeInfo[];
  current: WorktreeInfo | null;
  switchable: boolean;
}

/**
 * The chat models the session may run on.
 * @returns the list and the model in use.
 */
export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch("/models");
  if (!res.ok) {
    throw new Error(`GET /models failed: ${res.status}`);
  }
  return (await res.json()) as ModelsResponse;
}

/**
 * Switch the session to another model; the next turn runs on it.
 * @param index - a position in the /models list.
 * @returns the model now in use.
 */
export async function chooseModel(index: number): Promise<ChatModelOption> {
  const res = await fetch("/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  if (!res.ok) {
    throw new Error(`POST /model failed: ${res.status}`);
  }
  const body = (await res.json()) as { model: ChatModelOption };
  return body.model;
}

/**
 * The repository's checkouts, the one the process is in, and whether the page
 * may move it.
 * @returns the worktree listing.
 */
export async function fetchWorktrees(): Promise<WorktreesResponse> {
  const res = await fetch("/worktrees");
  if (!res.ok) {
    throw new Error(`GET /worktrees failed: ${res.status}`);
  }
  return (await res.json()) as WorktreesResponse;
}

/** Move the process into another checkout.
 * @param path - the checkout's path, as /worktrees reported it.
 * @returns the checkout the process now works in.
 */
export async function chooseWorktree(path: string): Promise<WorktreeInfo> {
  const res = await fetch("/worktree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    throw new Error(`POST /worktree failed: ${res.status}`);
  }
  const body = (await res.json()) as { worktree: WorktreeInfo };
  return body.worktree;
}

export interface ContextBreakdown {
  usedTokens: number;
  contextLimit: number;
  freeTokens: number;
  percentUsed: number;
  categories: {
    systemPrompt: number;
    tools: number;
    conversation: number;
    toolResults: number;
    contextItems: number;
  };
}

/**
 * Return the live token budget breakdown for the session.
 */
export async function fetchContextBreakdown(): Promise<ContextBreakdown> {
  const res = await fetch("/context");
  if (!res.ok) {
    throw new Error(`GET /context failed: ${res.status}`);
  }
  return (await res.json()) as ContextBreakdown;
}

/** The repository facts the top status menu shows. */
export interface GitStatus {
  repo: boolean;
  path: string;
  branch: string | null;
  head: string;
  detached: boolean;
  dirty: boolean;
  changedFiles: number;
  changes: Array<{ path: string; status: string; staged: boolean }>;
  latestCommit: { hash: string; subject: string } | null;
}

export interface PendingPermissionSummary {
  requestId: string;
  toolName: string;
  toolArgs: unknown;
  toolCallPreview?: unknown;
}

/** GET /git: checkout, branch, HEAD, latest commit and dirty state. */
export async function fetchGitStatus(): Promise<GitStatus> {
  const res = await fetch("/git");
  if (!res.ok) {
    throw new Error(`GET /git failed: ${res.status}`);
  }
  return (await res.json()) as GitStatus;
}

export interface WorkspacesResponse {
  workspaces: Array<{
    path: string;
    name: string;
    files: string[];
  }>;
}

export async function fetchWorkspaces(): Promise<WorkspacesResponse> {
  const res = await fetch("/workspaces");
  if (!res.ok) {
    throw new Error(`GET /workspaces failed: ${res.status}`);
  }
  return (await res.json()) as WorkspacesResponse;
}

export async function fetchApprovals(): Promise<PendingPermissionSummary[]> {
  const res = await fetch("/state");
  if (!res.ok) {
    throw new Error(`GET /state failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    pendingPermissions?: PendingPermissionSummary[];
  };
  return body.pendingPermissions ?? [];
}

export async function answerApproval(
  requestId: string,
  approved: boolean,
): Promise<void> {
  await post("/permission", { requestId, approved });
}

export interface PluginsResponse {
  plugins: Array<{
    id: string;
    name: string;
    version?: string | undefined;
    description?: string | undefined;
    path: string;
    enabled: boolean;
    skills: number;
    commands: number;
    agents: number;
    mcpServers: number;
  }>;
  skills: Array<{
    name: string;
    description: string;
    plugin: string;
    path?: string | undefined;
  }>;
  commands: Array<{ name: string; description: string; plugin: string }>;
  agents: Array<{ name: string; description: string; plugin: string }>;
  mcpServers: Record<string, unknown>;
  disabledPlugins: string[];
  unknownEnabledPlugins: string[];
  marketplaces: string[];
  settingsPath: string;
  pluginsDir: string;
}

/**
 * Return what this process has installed and loaded.
 */
export async function fetchPlugins(): Promise<PluginsResponse> {
  const res = await fetch("/plugins");
  if (!res.ok) {
    throw new Error(`GET /plugins failed: ${res.status}`);
  }
  return (await res.json()) as PluginsResponse;
}

/** Drop the server's plugin memo and return the fresh listing. */
export async function reloadPlugins(): Promise<PluginsResponse> {
  const res = await fetch("/plugins/reload", { method: "POST" });
  if (!res.ok) {
    throw new Error(`POST /plugins/reload failed: ${res.status}`);
  }
  return (await res.json()) as PluginsResponse;
}

/** Toggle one installed plugin for this project; returns the fresh listing. */
export async function setPluginEnabled(
  name: string,
  enabled: boolean,
): Promise<PluginsResponse> {
  const res = await fetch("/plugins/enabled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, enabled }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error ?? `POST /plugins/enabled failed: ${res.status}`,
    );
  }
  return (await res.json()) as PluginsResponse;
}

/** Reveal a path in the platform file manager. */
export async function openPath(target: string): Promise<void> {
  const res = await fetch("/workspace/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: target }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `POST /workspace/open failed: ${res.status}`);
  }
}

/**
 * Set a conversation's title.
 */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<void> {
  const res = await fetch("/session/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, title }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `POST /session/rename failed: ${res.status}`);
  }
}

/**
 * Remove a conversation from disk. The live session is refused; switch away
 * first.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch("/session/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `POST /session/delete failed: ${res.status}`);
  }
}
