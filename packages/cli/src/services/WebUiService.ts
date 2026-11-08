import type http from "http";

import type { Session } from "core/index.js";
import express, { type Express, type Request, type Response } from "express";

import type {
  PendingPermission,
  ServerState,
} from "../commands/serve.helpers.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import { publishAgentEvent } from "../protocol/eventBus.js";
import type { AgentEvent, AgentEventBase } from "../protocol/events.js";
import { services } from "../services/index.js";
import { quizService } from "../services/QuizService.js";
import {
  getCompleteStateSnapshot,
  getCurrentSession,
  getSessionGoal,
} from "../session/index.js";
import { messageQueue } from "../stream/messageQueue.js";
import type { WorktreeInfo } from "../utils/git.js";
import { logger } from "../utils/logger.js";
import { buildZcodeServiceCollection } from "../webuiZcode/serviceCollection.js";
import {
  startWebUiZcodeHost,
  type WebUiZcodeHost,
} from "../webuiZcode/wsHost.js";

import { turnRunnerService, type RunTurn } from "./TurnRunnerService.js";
import {
  registerWebUiAuthGate,
  registerWebUiSessionExchange,
  requestToken,
  resolveWebUiToken,
  webuiModuleDir,
} from "./webuiAuth.js";
import {
  resolveWebUiDist,
  webuiDistCandidates,
  type WebUiDist,
} from "./webuiDist.js";
import { bootstrapPage } from "./webuiPages.js";
import { registerWebUiRoutes } from "./webuiRoutes.js";
import { registerWebUiStaticRoutes } from "./webuiStatic.js";
import type {
  WebUiHandle,
  WebUiRouteContext,
  WebUiServiceOptions,
} from "./webuiTypes.js";

export type { RunTurn };
export type { WebUiHandle, WebUiServiceOptions };
export { resolveWebUiDist, webuiDistCandidates };
export type { WebUiDist };
export { listInstalledPlugins } from "./webuiPlugins.js";
export { WEBUI_TOKEN_FILE } from "./webuiAuth.js";

export const DEFAULT_WEBUI_PORT = 47610;
const MAX_PORT_ATTEMPTS = 100;

/**
 * HTTP surface for a browser frontend. The TUI process can start it in-process
 * (the /webui slash command, Task 5) or a standalone process can host it
 * (`tnt webui`, Task 5). Routes mirror `serve` but read live state: whether a
 * turn is in flight comes from TurnRunnerService and pending permissions come
 * from the permission manager, not from mutable fields only a serve loop
 * updates.
 *
 * The drain loop is shared with every other surface through turnRunnerService.
 * A message from the browser only runs when somebody drains the queue, so POST
 * /message calls startDraining after enqueueing. With no argument it falls
 * back to the default run turn registered at startup (the TUI's pipeline, the
 * standalone entrypoint's), and no-ops harmlessly in tests where none exists.
 *
 * Auth: every route sits behind a per-launch token gate except GET / (the
 * bootstrap page) and POST /webui-session (the exchange that turns the token
 * into the cookie). The browser opens `http://127.0.0.1:PORT/#token=...` - the
 * fragment never reaches the server - and the bootstrap page posts the token
 * to /webui-session, which validates it and sets an HttpOnly cookie. The
 * exempt set is deliberately minimal: /app/* static assets stay gated because
 * the SPA shell is useless without the API, and gating them keeps the
 * unauthenticated surface to two known shapes (both loopback-bound).
 */
export class WebUiService {
  private activeHandle: WebUiHandle | null = null;
  private activeZcodeHost: WebUiZcodeHost | null = null;
  private questionListener: ((event: unknown) => void) | null = null;
  private questionAnsweredListener: ((event: unknown) => void) | null = null;

  async start(options: WebUiServiceOptions = {}): Promise<WebUiHandle> {
    // One server at a time: a second /webui in the same TUI would otherwise
    // overwrite activeHandle and strand the first server, still bound and
    // still accepting its old token.
    await this.close();

    const app = express();
    app.use(express.json());

    const token = resolveWebUiToken(options.persistToken ?? false);

    // Every dist file is served as a name resolved against the dist directory
    // rather than as an absolute path: send() treats a dot-prefixed segment in
    // an absolute path as a dotfile and answers 404, which is exactly what an
    // install under ~/.tnt looks like. The paths are anchored at startup, not
    // at serve time, so a relative TNT_WEBUI_DIST reads against the process cwd.
    const dist = resolveWebUiDist(
      webuiModuleDir(),
      options.distDir ?? process.env.TNT_WEBUI_DIST,
    );

    // The gate must register before every route: the static routes end in a
    // catch-all when the dist is missing, and anything mounted after it
    // never sees the request.
    registerWebUiAuthGate(app, token);

    // GET / - token bootstrap when unauthenticated, the app otherwise. The
    // fragment `#token=...` never reaches the server, so this page reads
    // location.hash and posts the token to /webui-session, which sets the
    // cookie; on success it replaces itself with the real app. The bootstrap
    // page must win even when a dist exists: the SPA itself holds no token
    // exchange, so serving it to an unauthenticated request would strand the
    // user on a page that can never authenticate.
    app.get("/", (req: Request, res: Response) => {
      if (requestToken(req) === token) {
        if (dist.hasDist) {
          res.sendFile("index.html", { root: dist.distDir });
          return;
        }
        res.redirect("/app/");
        return;
      }
      res.status(200).type("html").send(bootstrapPage());
    });

    registerWebUiSessionExchange(app, token);

    // registerSseEventRoute only touches lastActivity on the state it is
    // handed; the routes below do the same, so a minimal object carries them.
    const state = {
      lastActivity: Date.now(),
    } as ServerState;

    const ctx: WebUiRouteContext = {
      options,
      state,
      token,
      snapshot: () => this.snapshot(options),
      snapshotFor: (session) => this.snapshotFor(session),
      sessionChangedEvent: (sessionId) => this.sessionChangedEvent(sessionId),
      modelChangedEvent: (model) => this.modelChangedEvent(model, options),
      workspaceChangedEvent: (worktree) =>
        this.workspaceChangedEvent(worktree, options),
      resolveSession: () => this.resolveSession(options),
      close: () => this.close(),
    };

    registerWebUiRoutes(app, ctx);

    // Static routes come last: the missing-dist fallback is a catch-all, and
    // registering it first would shadow every API route below it.
    registerWebUiStaticRoutes(app, dist);

    this.listenForQuestions(options);

    const handle = await this.listen(app, options, token);
    // The ZCode shell speaks RPC over /ws on the same server. Every connection
    // builds its own service scope; the stubs answer until Tasks 9-11 install
    // the real services.
    const workspacePath = this.resolveSession(options).workspaceDirectory;
    this.activeZcodeHost = startWebUiZcodeHost({
      server: handle.server,
      token,
      services: () => buildZcodeServiceCollection({ workspacePath }),
    });
    this.activeHandle = handle;

    return handle;
  }

  /**
   * The engine asks questions through quizService (the askQuestion tool);
   * the TUI hears them by subscribing, so the browser surface subscribes the
   * same way and the event reaches the stream as question.requested. The
   * answered signal clears the card on every other connected tab.
   */
  private listenForQuestions(options: WebUiServiceOptions): void {
    this.stopListeningForQuestions();
    this.questionListener = (event: unknown) => {
      const { requestId, question } = event as {
        requestId: string;
        question: {
          question?: string;
          options?: string[];
          defaultAnswer?: string;
        };
      };
      publishAgentEvent({
        ...this.changeTurnEvent("question", options),
        type: "question.requested",
        requestId,
        question: question?.question ?? "",
        options: question?.options,
        defaultAnswer: question?.defaultAnswer,
      });
    };
    this.questionAnsweredListener = (event: unknown) => {
      const { requestId } = event as { requestId?: string };
      publishAgentEvent({
        ...this.changeTurnEvent("question", options),
        type: "question.answered",
        requestId: requestId ?? "",
      });
    };
    quizService.on("questionRequested", this.questionListener);
    quizService.on("questionAnswered", this.questionAnsweredListener);
  }

  private stopListeningForQuestions(): void {
    if (this.questionListener) {
      quizService.off("questionRequested", this.questionListener);
      this.questionListener = null;
    }
    if (this.questionAnsweredListener) {
      quizService.off("questionAnswered", this.questionAnsweredListener);
      this.questionAnsweredListener = null;
    }
  }

  /** Closes the server this instance last started, if any. */
  async close(): Promise<void> {
    this.stopListeningForQuestions();
    if (this.activeZcodeHost) {
      const host = this.activeZcodeHost;
      this.activeZcodeHost = null;
      await host.close();
    }
    if (this.activeHandle) {
      const handle = this.activeHandle;
      this.activeHandle = null;
      await handle.close();
    }
  }

  /** The snapshot shape GET /state returns, reading the live current session. */
  private snapshot(options: WebUiServiceOptions): Record<string, unknown> {
    return this.snapshotFor(this.resolveSession(options));
  }

  /**
   * The snapshot for an explicit session: the session routes must report the
   * session they just installed, not whichever one getCurrentSession lazily
   * conjures, so the session object itself is the argument.
   */
  private snapshotFor(session: Session): Record<string, unknown> {
    return {
      ...getCompleteStateSnapshot(
        session,
        turnRunnerService.isRunning(),
        messageQueue.getQueueLength(),
        this.currentPendingPermission() ??
          quizService.getState().pendingQuestion,
      ),
      ...(process.env.VITEST
        ? {}
        : { pendingPermissions: this.currentPendingPermissions() }),
      permissionMode: services.toolPermissions.getState().currentMode,
      goal: getSessionGoal() ?? null,
    };
  }

  /** The SSE signal that makes every connected tab drop the old transcript. */
  private sessionChangedEvent(sessionId: string): AgentEvent {
    return {
      sessionId,
      turnId: `session-${Date.now()}`,
      seq: 0,
      timestamp: Date.now(),
      type: "session.changed",
    };
  }

  /**
   * The envelope every change event carries: they announce a shift in the
   * process's own state, so the session they belong to is the live one.
   */
  private changeTurnEvent(
    kind: string,
    options: WebUiServiceOptions,
  ): AgentEventBase {
    return {
      sessionId: this.resolveSession(options).sessionId,
      turnId: `${kind}-${Date.now()}`,
      seq: 0,
      timestamp: Date.now(),
    };
  }

  /** The SSE signal that re-labels the model on every connected tab. */
  private modelChangedEvent(
    model: string,
    options: WebUiServiceOptions,
  ): AgentEvent {
    return {
      ...this.changeTurnEvent("model", options),
      type: "model.changed",
      model,
    };
  }

  /** The SSE signal that re-labels the checkout on every connected tab. */
  private workspaceChangedEvent(
    worktree: WorktreeInfo,
    options: WebUiServiceOptions,
  ): AgentEvent {
    return {
      ...this.changeTurnEvent("workspace", options),
      type: "workspace.changed",
      path: worktree.path,
      branch: worktree.branch,
    };
  }

  private resolveSession(options: WebUiServiceOptions): Session {
    if (options.getSession) {
      return options.getSession();
    }

    // The default reads the process's current session without creating one;
    // an uninitialized process (tests, a bare standalone start) reports an
    // empty history rather than conjuring a session on disk.
    try {
      const current = getCurrentSession();
      if (current) {
        return current;
      }
    } catch (error) {
      logger.debug(
        `WebUiService: no live session to report (${String(error)})`,
      );
    }

    return {
      sessionId: "",
      title: "",
      workspaceDirectory: process.cwd(),
      history: [],
    };
  }

  private currentPendingPermission(): PendingPermission | null {
    const [requestId] = toolPermissionManager.getPendingRequestIds();
    if (!requestId) {
      return null;
    }

    const request = toolPermissionManager.getPendingRequest(requestId);
    if (!request) {
      return null;
    }

    return {
      toolName: request.toolCall.name,
      toolArgs: request.toolCall.arguments,
      requestId,
      timestamp: Date.now(),
      toolCallPreview: request.toolCall.preview,
    };
  }

  private currentPendingPermissions(): PendingPermission[] {
    return toolPermissionManager.getPendingRequests().map((request) => ({
      toolName: request.toolCall.name,
      toolArgs: request.toolCall.arguments,
      requestId: request.requestId,
      timestamp: Date.now(),
      toolCallPreview: request.toolCall.preview,
    }));
  }

  private async listen(
    app: Express,
    options: WebUiServiceOptions,
    token: string,
  ): Promise<WebUiHandle> {
    const startPort = options.port ?? DEFAULT_WEBUI_PORT;
    const maxAttempts = options.maxAttempts ?? MAX_PORT_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = startPort + attempt;
      try {
        const server = await new Promise<http.Server>((resolve, reject) => {
          const bound = app.listen(port, "127.0.0.1");
          bound.once("listening", () => resolve(bound));
          bound.once("error", reject);
        });
        const address = server.address();
        return {
          port: typeof address === "object" && address ? address.port : port,
          token,
          server,
          close: () =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
              // An open SSE stream never ends on its own, and server.close
              // waits for every connection to finish - without this a single
              // browser tab keeps the server (or the standalone process)
              // alive after /exit or stop.
              server.closeAllConnections();
            }),
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EADDRINUSE") {
          throw error;
        }
        logger.debug(`WebUiService: port ${port} in use, probing upwards`);
      }
    }

    throw new Error(
      `Web UI could not find a free port: ${startPort} through ${startPort + maxAttempts - 1} are all in use`,
    );
  }
}

export const webUiService = new WebUiService();
