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
