import { TntError, TntErrorReason } from "core/util/errors.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const DISCOVERY_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 10_000;

export interface BrowserClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface BrowserTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface WebSocketMessage {
  data: unknown;
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "error", handler: () => void): void;
  addEventListener(
    type: "message",
    handler: (event: WebSocketMessage) => void,
  ): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

function browserEndpoint(): string {
  return (
    process.env.CONTINUE_CLI_BROWSER_ENDPOINT ?? DEFAULT_ENDPOINT
  ).replace(/\/$/, "");
}

async function pageSocketUrl(endpoint: string): Promise<string> {
  const response = await fetch(`${endpoint}/json/list`, {
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `Could not reach the browser at ${endpoint}: ${response.status} ${response.statusText}. Start it with --remote-debugging-port=9222 or set CONTINUE_CLI_BROWSER_ENDPOINT.`,
    );
  }

  const targets = (await response.json()) as BrowserTarget[];
  const page =
    targets.find(
      (target) => target.type === "page" && target.webSocketDebuggerUrl,
    ) ?? targets.find((target) => target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `The browser at ${endpoint} exposes no page target.`,
    );
  }
  return page.webSocketDebuggerUrl;
}

/**
 * Connects to a browser the user started with a remote debugging port. The
 * CLI does not launch one: a browser the user can see and steer is the point,
 * and a hidden instance would make every click unauditable.
 */
export async function connectBrowser(
  endpoint: string = browserEndpoint(),
): Promise<BrowserClient & { close(): void }> {
  const socketUrl = await pageSocketUrl(endpoint);
  const Constructor = (globalThis as { WebSocket?: WebSocketConstructor })
    .WebSocket;
  if (!Constructor) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "This Node runtime has no WebSocket. Use a Node version with a global WebSocket (22+) or drive the browser through an MCP server.",
    );
  }

  const socket = new Constructor(socketUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out opening the browser socket.")),
      DISCOVERY_TIMEOUT_MS,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("The browser refused the debugging socket."));
    });
  });

  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  socket.addEventListener("message", (event) => {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(
        new Error(message.error.message ?? "Browser command failed"),
      );
    } else {
      entry.resolve(message.result);
    }
  });

  socket.addEventListener("error", () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("The browser debugging socket failed."));
    }
    pending.clear();
  });

  return {
    send(method: string, params?: Record<string, unknown>) {
      return new Promise<unknown>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser command timed out: ${method}`));
        }, COMMAND_TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => resolve(value),
          reject,
          timer,
        });
        socket.send(JSON.stringify({ id, method, params: params ?? {} }));
      });
    },
    close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("The browser connection was closed."));
      }
      pending.clear();
      socket.close();
    },
  };
}
