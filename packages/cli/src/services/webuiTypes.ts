import type http from "http";

import type { Session } from "core/index.js";

import type { ServerState } from "../commands/serve.helpers.js";
import type { AgentEvent } from "../protocol/events.js";
import type { WorktreeInfo } from "../utils/git.js";

import type { ContextBreakdown } from "./contextBreakdown.js";
import type { ChatModelOption } from "./modelCatalog.js";
import type { RunTurn } from "./TurnRunnerService.js";

export interface WebUiServiceOptions {
  /** Port to try first; occupied ports are probed upwards. */
  port?: number;
  /** Owned by Task 5: the TUI's turn pipeline, or a test double. */
  runTurn?: RunTurn;
  /**
   * The session the snapshot endpoint reports. Defaults to the process's
   * current session, which Task 5 points at the TUI's live session.
   */
  getSession?: () => Session;
  /**
   * Where the built frontend lives. Defaults to the copy inside this package;
   * TNT_WEBUI_DIST overrides it the same way.
   */
  distDir?: string;
  /** Test seam: how many ports may be probed before giving up. */
  maxAttempts?: number;
  /**
   * Long-lived mode (`tnt webui`, Task 5): reuse the token stored under
   * globalDir so a restart keeps serving the same URL. Defaults to false,
   * where every launch generates a fresh token.
   */
  persistToken?: boolean;
  /**
   * True when this process hosts its own session (`tnt webui`) and the
   * session routes may switch it. The in-process TUI (`/webui`) keeps its
   * session in a TUI-owned loop; letting the browser switch it would desync
   * the terminal, so the routes refuse there.
   */
  ownsSession?: boolean;
  /**
   * How /session/new builds the fresh session. Defaults to startNewSession;
   * the standalone entrypoint supplies one that carries the system message.
   */
  createNewSession?: () => Session;
  /**
   * The chat models this process can run. Absent when the surface offers no
   * model choice, which GET /models reports rather than faking a list.
   */
  listModels?: () => ChatModelOption[];
  /**
   * Move the process to another chat model, the way the /model screen does.
   * Absent when the surface cannot change the model.
   */
  switchModel?: (index: number) => Promise<ChatModelOption>;
  /**
   * The repository's checkouts. Absent when the process is not inside a
   * repository, which GET /worktrees reports as "no checkouts".
   */
  listWorktrees?: () => WorktreeInfo[];
  /** The checkout the process works in right now. */
  currentWorktree?: () => WorktreeInfo | null;
  /**
   * Move the process into another checkout. Only a process that owns its
   * session may do this: the tools read the process's working directory, so
   * a move changes where the agent works.
   */
  switchWorktree?: (path: string) => Promise<WorktreeInfo>;
  /**
   * The token breakdown calculation for the current session. Defaults to
   * building it from the session history and active model.
   */
  getContextBreakdown?: () => ContextBreakdown | Promise<ContextBreakdown>;
}

export interface WebUiHandle {
  /** The port the server actually bound, after probing. */
  port: number;
  /** The token every gated route demands, via cookie or Bearer header. */
  token: string;
  server: http.Server;
  close(): Promise<void>;
}

/**
 * What the route handlers need from the service that owns them. The handlers
 * live outside the class so each file stays readable; this is the seam
 * between the two.
 */
export interface WebUiRouteContext {
  options: WebUiServiceOptions;
  state: ServerState;
  token: string;
  snapshot(): Record<string, unknown>;
  snapshotFor(session: Session): Record<string, unknown>;
  sessionChangedEvent(sessionId: string): AgentEvent;
  modelChangedEvent(model: string): AgentEvent;
  workspaceChangedEvent(worktree: WorktreeInfo): AgentEvent;
  resolveSession: () => Session;
  close(): Promise<void>;
}
