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
