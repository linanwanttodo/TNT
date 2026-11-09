import type http from "http";

import type { Session } from "core/index.js";
import express, { type Express, type Request, type Response } from "express";

import type { ServerState } from "../commands/serve.helpers.js";
import { publishAgentEvent } from "../protocol/eventBus.js";
import { quizService } from "../services/QuizService.js";
import { getCurrentSession } from "../session/index.js";
import { logger } from "../utils/logger.js";
import { buildZcodeServiceCollection } from "../webuiZcode/serviceCollection.js";
import type { WorkspaceEngines } from "../webuiZcode/workspaceEngines.js";
import { startWebUiZcodeHost } from "../webuiZcode/wsHost.js";

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
import { readWebUiModelSource } from "./webuiModelSource.js";
import { bootstrapPage } from "./webuiPages.js";
import { getWebUiProjectCatalog } from "./webuiProjectCatalog.js";
import { registerWebUiServerInfoRoute } from "./webuiServerInfo.js";
import { registerWebUiStaticRoutes } from "./webuiStatic.js";
import type { WebUiHandle, WebUiServiceOptions } from "./webuiTypes.js";

export type { WebUiHandle, WebUiServiceOptions };
export { resolveWebUiDist, webuiDistCandidates };
export type { WebUiDist };

export const DEFAULT_WEBUI_PORT = 47610;
const MAX_PORT_ATTEMPTS = 100;

/**
 * HTTP surface for a browser frontend. The TUI process can start it in-process
 * (the /webui slash command) or a standalone process can host it
 * (`tnt webui`). It serves the static frontend, the token exchange, the
 * workspace listing the ZCode entry reads, and the ZCode RPC host at /ws.
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
  private engines: WorkspaceEngines | null = null;
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

    // registerWebUiServerInfoRoute only touches lastActivity on the state it
    // is handed, so a minimal object carries it.
    const state = {
      lastActivity: Date.now(),
    } as ServerState;

    registerWebUiServerInfoRoute(app, {
      state,
      resolveSession: () => this.resolveSession(options),
    });

    // Static routes come last: the missing-dist fallback is a catch-all, and
    // registering it first would shadow every route above it.
    registerWebUiStaticRoutes(app, dist);

    this.listenForQuestions(options);

    const handle = await this.listen(app, options, token);
    // Claim the bound server before anything can throw: a failure past this
    // point must close it rather than strand it under the old token.
    this.activeHandle = handle;

    // The ZCode shell speaks RPC over /ws on the same server. Every connection
    // builds its own service scope; the workspace engine registry is shared by
    // the process so a second workspace gets exactly one child engine. The
    // workspace is read per connection so a worktree switch is reflected by the
    // next one.
    try {
      const hostWorkspacePath =
        this.resolveSession(options).workspaceDirectory || process.cwd();
      const { WorkspaceEngines } =
        await import("../webuiZcode/workspaceEngines.js");
      const engines = new WorkspaceEngines({ hostWorkspacePath });
      this.engines = engines;

      // Projects the operator opened in an earlier run must be allowed roots
      // again before the file and terminal services see them. Registration
      // only validates and records the directory; a child engine starts on
      // first use. A workspace that has since disappeared is skipped here and
      // reported as missing by the project surface instead.
      const projectCatalog = getWebUiProjectCatalog();
      for (const record of projectCatalog.all()) {
        if (record.deleted) {
          continue;
        }
        try {
          await engines.add(record.path);
        } catch (error) {
          logger.debug(
            `WebUiService: catalog workspace unavailable ${record.path} (${String(error)})`,
          );
        }
      }

      const zcodeHost = startWebUiZcodeHost({
        server: handle.server,
        token,
        services: () =>
          buildZcodeServiceCollection({
            workspacePath:
              this.resolveSession(options).workspaceDirectory ||
              hostWorkspacePath,
            workspaceRoots: () => engines.roots(),
            workspaceEngines: engines,
            projectCatalog,
            modelSelectionSource: readWebUiModelSource,
          }),
      });

      // The handle owns the whole teardown, so callers cannot close the HTTP
      // server and leave the upgrade listener attached. Memoized to stay
      // idempotent when both the caller and WebUiService.close() run it.
      const closeServer = handle.close;
      let closed: Promise<void> | null = null;
      handle.close = (): Promise<void> => {
        closed ??= (async () => {
          await zcodeHost.close();
          await closeServer();
        })();
        return closed;
      };
    } catch (error) {
      await this.close();
      throw error;
    }

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
        sessionId: this.resolveSession(options).sessionId,
        turnId: `question-${Date.now()}`,
        seq: 0,
        timestamp: Date.now(),
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
        sessionId: this.resolveSession(options).sessionId,
        turnId: `question-${Date.now()}`,
        seq: 0,
        timestamp: Date.now(),
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
    const engines = this.engines;
    this.engines = null;
    try {
      if (this.activeHandle) {
        const handle = this.activeHandle;
        this.activeHandle = null;
        await handle.close();
      }
    } finally {
      // Every workspace child is owned by this server; no child outlives close.
      await engines?.dispose();
      // The ZCode services own OS handles and a heavy node dependency graph, so
      // the bundle is loaded lazily per connection; close is the only place the
      // host has to reach it directly.
      const { disposeLocalZcodeServices } =
        await import("../webuiZcode/services/local.js");
      disposeLocalZcodeServices();
    }
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
              // server.close waits for every connection to finish - without
              // this an open browser connection keeps the server (or the
              // standalone process) alive after /exit or stop.
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
