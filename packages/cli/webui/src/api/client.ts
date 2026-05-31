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
  "question.answered",
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
    description: "Accept safe actions automatically, ask for the rest",
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
    mode: "dontAsk",
    label: "Don't ask",
    description: "Never prompt; tools that would ask are unavailable",
  },
  {
    mode: "bypassPermissions",
    label: "Bypass permissions",
    description: "Skip every permission check",
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
  remember = false,
): Promise<void> {
  await post("/permission", { requestId, approved, remember });
}

export async function stopTurn(): Promise<void> {
  await post("/pause");
}

/**
 * The session goal the engine's system message reads each turn.
 * @returns the goal text, or null when no goal is set.
 */
export async function fetchGoal(): Promise<string | null> {
  const res = await fetch("/goal");
  if (!res.ok) {
    throw new Error(`GET /goal failed: ${res.status}`);
  }
  const body = (await res.json()) as { goal: string | null };
  return body.goal;
}

/**
 * Store or clear the session goal. The system message reads it from the next
 * turn on, so the agent works toward what the goal pill shows. An empty
 * string clears it.
 */
export async function setSessionGoalText(goal: string): Promise<void> {
  await post("/goal", { goal });
}

/**
 * Answer a pending engine question (the askQuestion tool waits on it).
 * @returns false when the question was answered elsewhere already.
 */
export async function answerQuestion(
  requestId: string,
  answer: string,
  isCustomAnswer = false,
): Promise<boolean> {
  const res = await fetch("/question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, answer, isCustomAnswer }),
  });
  if (!res.ok) {
    throw await readError(res, `POST /question failed: ${res.status}`);
  }
  const body = (await res.json()) as { answered: boolean };
  return body.answered;
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
  /** The entries config.yaml declares; present on servers with the store. */
  declared?: DeclaredModel[];
  /** The file the declared entries live in, for the settings footer. */
  configPath?: string | null;
}

/**
 * One config.yaml model entry, as the Models settings page edits it. The
 * secret itself never travels: only whether an apiKey is set.
 */
export interface DeclaredModel {
  name: string;
  model: string;
  provider: string;
  hasApiKey: boolean;
  apiBase: string | null;
  roles: string[];
  contextLength: number | null;
}

/** The writable fields of a model entry, as POST /models accepts them. */
export interface ModelConfigInput {
  name: string;
  model: string;
  provider: string;
  apiKey?: string;
  apiBase?: string;
  roles?: string[];
  contextLength?: number;
}

/** What a successful create/update/delete answers with: the fresh list. */
export interface ModelMutationResponse {
  declared: DeclaredModel[];
  configPath: string;
}

/** POST /models/test: one real provider round trip. */
export interface ModelTestResult {
  ok: boolean;
  detail: string;
  latencyMs: number;
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? fallback);
}

/**
 * Add a model entry to the server's config.yaml; the process reloads its
 * model list, so the entry is usable without a restart.
 */
export async function addModel(
  input: ModelConfigInput,
): Promise<ModelMutationResponse> {
  const res = await fetch("/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw await readError(res, `POST /models failed: ${res.status}`);
  }
  return (await res.json()) as ModelMutationResponse;
}

/**
 * Patch one model entry by name. An apiKey of "" keeps the stored secret.
 */
export async function updateModel(
  name: string,
  patch: Partial<ModelConfigInput>,
): Promise<ModelMutationResponse> {
  const res = await fetch("/models/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, patch }),
  });
  if (!res.ok) {
    throw await readError(res, `POST /models/update failed: ${res.status}`);
  }
  return (await res.json()) as ModelMutationResponse;
}

/**
 * Remove one model entry by name; a deleted selection moves to the first
 * remaining entry.
 */
export async function deleteModel(
  name: string,
): Promise<ModelMutationResponse> {
  const res = await fetch("/models/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw await readError(res, `POST /models/delete failed: ${res.status}`);
  }
  return (await res.json()) as ModelMutationResponse;
}

/**
 * Persist a drag-reorder: the submitted list must be a permutation of the
 * declared entries; the server rewrites config.yaml's ordering.
 */
export async function reorderModels(
  names: string[],
): Promise<ModelMutationResponse> {
  const res = await fetch("/models/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  if (!res.ok) {
    throw await readError(res, `POST /models/reorder failed: ${res.status}`);
  }
  return (await res.json()) as ModelMutationResponse;
}

/**
 * Send one tiny completion to the provider the form describes, so "Test
 * connection" answers with a real latency and the provider's own error when
 * the credentials are wrong.
 */
export async function testModel(
  input: ModelConfigInput,
): Promise<ModelTestResult> {
  const res = await fetch("/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw await readError(res, `POST /models/test failed: ${res.status}`);
  }
  return (await res.json()) as ModelTestResult;
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

/** GET /workspace/file: one text file's contents, for the tree's preview. */
export interface WorkspaceFile {
  path: string;
  content: string;
  truncated: boolean;
}

export async function fetchWorkspaceFile(path: string): Promise<WorkspaceFile> {
  const res = await fetch(`/workspace/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    throw await readError(res, `GET /workspace/file failed: ${res.status}`);
  }
  return (await res.json()) as WorkspaceFile;
}

/** GET /git/diff: the working-tree diff of one file. */
export interface GitFileDiff {
  path: string;
  diff: string;
}

export async function fetchGitFileDiff(path: string): Promise<GitFileDiff> {
  const res = await fetch(`/git/diff?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    throw await readError(res, `GET /git/diff failed: ${res.status}`);
  }
  return (await res.json()) as GitFileDiff;
}

/** GET /team: the rosters this workspace knows, with the active one flagged. */
export interface TeamResponse {
  teams: Array<{
    name: string;
    active: boolean;
    members: Array<{
      name: string;
      description: string;
      lead: boolean;
      source: "project" | "global" | "default";
    }>;
  }>;
}

export async function fetchTeam(): Promise<TeamResponse> {
  const res = await fetch("/team");
  if (!res.ok) {
    throw await readError(res, `GET /team failed: ${res.status}`);
  }
  return (await res.json()) as TeamResponse;
}

/** One plugin inside a registered marketplace's manifest. */
export interface MarketplacePlugin {
  name: string;
  description: string;
  version: string;
  category: string;
  installed: boolean;
}

/** GET /plugins/marketplaces: the catalogues and what they carry. */
export interface MarketplacesResponse {
  marketplaces: Array<{
    name: string;
    lastUpdated: string | null;
    plugins: MarketplacePlugin[];
  }>;
}

export async function fetchMarketplaces(): Promise<MarketplacesResponse> {
  const res = await fetch("/plugins/marketplaces");
  if (!res.ok) {
    throw await readError(
      res,
      `GET /plugins/marketplaces failed: ${res.status}`,
    );
  }
  return (await res.json()) as MarketplacesResponse;
}

/** POST /plugins/marketplaces/refresh: re-fetch one catalogue. */
export async function refreshMarketplaceApi(
  name: string,
): Promise<MarketplacesResponse> {
  const res = await fetch("/plugins/marketplaces/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw await readError(
      res,
      `POST /plugins/marketplaces/refresh failed: ${res.status}`,
    );
  }
  return (await res.json()) as MarketplacesResponse;
}

/** POST /plugins/marketplaces/install: install one plugin from a catalogue. */
export async function installMarketplacePlugin(
  marketplace: string,
  plugin: string,
): Promise<MarketplacesResponse> {
  const res = await fetch("/plugins/marketplaces/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marketplace, plugin }),
  });
  if (!res.ok) {
    throw await readError(
      res,
      `POST /plugins/marketplaces/install failed: ${res.status}`,
    );
  }
  return (await res.json()) as MarketplacesResponse;
}

/** One scheduled agent run in the automation registry. */
export interface Automation {
  id: string;
  title: string;
  prompt: string;
  cronExpr?: string;
  recurring: boolean;
  maxRuns?: number;
  runCount: number;
  enabled: boolean;
  createdAt: number;
  nextRunAt: number | null;
  lastRunAt?: number;
  failCount?: number;
}

/** GET /automations: the registry's contents. */
export interface AutomationsResponse {
  automations: Automation[];
}

export async function fetchAutomations(): Promise<AutomationsResponse> {
  const res = await fetch("/automations");
  if (!res.ok) {
    throw await readError(res, `GET /automations failed: ${res.status}`);
  }
  return (await res.json()) as AutomationsResponse;
}

/** POST /automations: create one; exactly one schedule mode is required. */
export async function createAutomationApi(input: {
  title: string;
  prompt: string;
  cronExpr?: string;
  interval?: { unit: "minute" | "hour" | "day" | "week"; value: number };
  delayMinutes?: number;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
}): Promise<AutomationsResponse> {
  const res = await fetch("/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw await readError(res, `POST /automations failed: ${res.status}`);
  }
  return (await res.json()) as AutomationsResponse;
}

/** POST /automations/delete. */
export async function deleteAutomationApi(
  id: string,
): Promise<AutomationsResponse> {
  const res = await fetch("/automations/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw await readError(
      res,
      `POST /automations/delete failed: ${res.status}`,
    );
  }
  return (await res.json()) as AutomationsResponse;
}

/** POST /automations/enabled: pause or resume one. */
export async function setAutomationEnabledApi(
  id: string,
  enabled: boolean,
): Promise<AutomationsResponse> {
  const res = await fetch("/automations/enabled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, enabled }),
  });
  if (!res.ok) {
    throw await readError(
      res,
      `POST /automations/enabled failed: ${res.status}`,
    );
  }
  return (await res.json()) as AutomationsResponse;
}

/** POST /automations/run: fire one immediately. */
export async function runAutomationApi(
  id: string,
): Promise<AutomationsResponse> {
  const res = await fetch("/automations/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    throw await readError(res, `POST /automations/run failed: ${res.status}`);
  }
  return (await res.json()) as AutomationsResponse;
}

/**
 * Close the web UI's HTTP server. In the TUI the terminal keeps running;
 * standalone (`tnt webui`) the process exits after the response.
 */
export async function closeWebUi(): Promise<void> {
  await post("/exit");
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
