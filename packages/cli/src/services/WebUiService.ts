import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

import type { Session } from "core/index.js";
import express, { type Express, type Request, Response } from "express";

import {
  registerSseEventRoute,
  type PendingPermission,
  type ServerState,
} from "../commands/serve.helpers.js";
import { globalDir } from "../config/globalDir.js";
import { t } from "../i18n/index.js";
import { interactionBroker } from "../permissions/interactionBroker.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import {
  getCompleteStateSnapshot,
  getCurrentSession,
} from "../session/index.js";
import { messageQueue } from "../stream/messageQueue.js";
import { logger } from "../utils/logger.js";

import { turnRunnerService, type RunTurn } from "./TurnRunnerService.js";

export type { RunTurn };

export const DEFAULT_WEBUI_PORT = 47610;
export const WEBUI_TOKEN_FILE = "webui-token";
const TOKEN_COOKIE = "tnt_webui_token";
const MAX_PORT_ATTEMPTS = 100;

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
  /** Where the built frontend lives; overridden by TNT_WEBUI_DIST. */
  distDir?: string;
  /** Test seam: how many ports may be probed before giving up. */
  maxAttempts?: number;
  /**
   * Long-lived mode (`tnt webui`, Task 5): reuse the token stored under
   * globalDir so a restart keeps serving the same URL. Defaults to false,
   * where every launch generates a fresh token.
   */
  persistToken?: boolean;
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
 * HTTP surface for a browser frontend. The TUI process can start it in-process
 * (the /webui slash command, Task 5) or a standalone process can host it
 * (`tnt webui`, Task 5). Routes mirror `serve` but read live state: whether a
 * turn is in flight comes from TurnRunnerService and pending permissions come
 * from the permission manager, not from mutable fields only a serve loop
 * updates.
 *
 * The drain loop is shared with every other surface through turnRunnerService.
 * A message from the browser only runs when somebody drains the queue, so POST
 * /message calls startDraining after enqueueing - but only when the caller
 * supplied a runTurn. Task 5 passes the TUI's own turn pipeline; without one
 * (a standalone process before Task 5, tests) the message stays queued rather
 * than being consumed by a turn that cannot run.
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

  async start(options: WebUiServiceOptions = {}): Promise<WebUiHandle> {
    const app = express();
    app.use(express.json());

    const token = this.resolveToken(options);

    const distDir =
      options.distDir ??
      process.env.TNT_WEBUI_DIST ??
      path.resolve(process.cwd(), "node_modules", "tnt-webui", "dist");
    const hasDist = fs.existsSync(distDir);

    // The gate must register before every route: registerStaticRoutes ends in
    // a catch-all when the dist is missing, and anything mounted after it
    // never sees the request.
    app.use((req, res, next) => {
      // Exempt: the bootstrap page and the exchange that mints the cookie.
      // Everything else - API routes, /app/* assets, the missing-dist
      // fallback - demands the token.
      if (req.method === "GET" && req.path === "/") {
        next();
        return;
      }
      if (req.method === "POST" && req.path === "/webui-session") {
        next();
        return;
      }
      if (tokenEquals(this.requestToken(req) ?? "", token)) {
        next();
        return;
      }
      res.status(401).json({ error: t("services.webuiUnauthorized") });
    });

    // GET / - token bootstrap when unauthenticated, the app otherwise. The
    // fragment `#token=...` never reaches the server, so this page reads
    // location.hash and posts the token to /webui-session, which sets the
    // cookie; on success it replaces itself with the real app.
    app.get("/", (req: Request, res: Response) => {
      if (hasDist) {
        res.sendFile(path.join(distDir, "index.html"));
        return;
      }
      if (this.requestToken(req) === token) {
        res.redirect("/app/");
        return;
      }
      res.status(200).type("html").send(this.bootstrapPage());
    });

    // POST /webui-session - exchange the launch token for the session cookie.
    app.post("/webui-session", (req: Request, res: Response) => {
      const presented = req.body?.token;
      if (typeof presented !== "string" || !tokenEquals(presented, token)) {
        res.status(401).json({ error: t("services.webuiUnauthorized") });
        return;
      }
      res.setHeader(
        "Set-Cookie",
        `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
      );
      res.json({ ok: true });
    });

    // registerSseEventRoute only touches lastActivity on the state it is
    // handed; the routes below do the same, so a minimal object carries them.
    const state = {
      lastActivity: Date.now(),
    } as ServerState;

    // GET /state - Return the live engine snapshot.
    app.get("/state", (_req: Request, res: Response) => {
      state.lastActivity = Date.now();
      const session = this.resolveSession(options);
      const pending = this.currentPendingPermission();
      res.json(
        getCompleteStateSnapshot(
          session,
          turnRunnerService.isRunning(),
          messageQueue.getQueueLength(),
          pending,
        ),
      );
    });

    // GET /events - Stream the engine event contract as server-sent events.
    registerSseEventRoute(app, state);

    // POST /message - Queue a message and make sure somebody drains it.
    app.post("/message", async (req: Request, res: Response) => {
      state.lastActivity = Date.now();

      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message field is required" });
      }

      await messageQueue.enqueueMessage(message);

      res.json({
        queued: true,
        position: messageQueue.getQueueLength(),
      });

      // Idempotent: a live loop (the TUI already draining) ignores this; an
      // idle engine starts one that will pick the message up.
      if (options.runTurn) {
        turnRunnerService.startDraining(options.runTurn);
      }
    });

    // POST /permission - Approve or reject a pending tool permission. The
    // broker answers the manager directly, so a response for an id that has
    // since expired (or arrived out of order) still resolves the waiting
    // turn; only a missing id is a client error.
    app.post("/permission", async (req: Request, res: Response) => {
      state.lastActivity = Date.now();

      const { requestId, approved } = req.body;

      if (!requestId) {
        return res.status(400).json({ error: "requestId is required" });
      }

      if (approved) {
        interactionBroker.approve(requestId);
      } else {
        interactionBroker.reject(requestId);
      }

      res.json({
        success: true,
        approved,
      });
    });

    // POST /pause - Stop the current run (like pressing escape in the TUI).
    // requestStop aborts the in-flight turn and notifies the surfaces that
    // registered a stop listener, so the TUI's stream truncates too.
    app.post("/pause", async (_req: Request, res: Response) => {
      state.lastActivity = Date.now();
      turnRunnerService.requestStop();

      res.json({
        success: true,
        message: "Agent run paused",
      });
    });

    // POST /exit - Close the HTTP server. Deliberately does not exit the
    // process: the TUI hosts this service in-process and must survive it.
    // Standalone lifecycle (signals, graceful teardown) is Task 5's.
    app.post("/exit", async (_req: Request, res: Response) => {
      res.json({ message: "Web UI server closing", success: true });
      await this.close();
    });

    // Static routes come last: the missing-dist fallback is a catch-all, and
    // registering it first would shadow every API route below it.
    this.registerStaticRoutes(app, distDir, hasDist);

    const handle = await this.listen(app, options, token);
    this.activeHandle = handle;

    return handle;
  }

  /**
   * The token this launch demands: reused from globalDir in long-lived mode
   * (0600, so only the user reads it), otherwise freshly generated.
   */
  private resolveToken(options: WebUiServiceOptions): string {
    if (!options.persistToken) {
      return crypto.randomBytes(32).toString("base64url");
    }

    const file = path.join(globalDir(), WEBUI_TOKEN_FILE);
    try {
      const persisted = fs.readFileSync(file, "utf8").trim();
      if (persisted.length > 0) {
        return persisted;
      }
    } catch {
      // Missing or unreadable: fall through to generating a fresh one.
    }

    const generated = crypto.randomBytes(32).toString("base64url");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    try {
      // The mode option does not survive an existing file and some platforms
      // ignore it; the permission is the point of the file, so enforce it.
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows and sandboxes without chmod still get a usable token file.
    }
    return generated;
  }

  /** The token a request carries: the session cookie or a Bearer header. */
  private requestToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length);
    }

    const cookies = req.headers.cookie;
    if (typeof cookies !== "string") {
      return undefined;
    }
    for (const segment of cookies.split(";")) {
      const at = segment.indexOf("=");
      if (at === -1 || segment.slice(0, at).trim() !== TOKEN_COOKIE) {
        continue;
      }
      return segment.slice(at + 1).trim();
    }
    return undefined;
  }

  private bootstrapPage(): string {
    return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>tnt web ui</title></head>
  <body>
    <p id="bootstrap-error" hidden></p>
    <script>
      (function () {
        var token = location.hash.match(/token=([^&]+)/);
        var error = document.getElementById("bootstrap-error");
        if (!token) {
          error.textContent = "Missing token in URL fragment.";
          error.hidden = false;
          return;
        }
        fetch("/webui-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: decodeURIComponent(token[1]) })
        })
          .then(function (response) {
            if (!response.ok) {
              error.textContent = "Token rejected by the server.";
              error.hidden = false;
              return;
            }
            location.replace("/");
          })
          .catch(function (err) {
            error.textContent = String(err && err.message ? err.message : err);
            error.hidden = false;
          });
      })();
    </script>
  </body>
</html>`;
  }

  /** Closes the server this instance last started, if any. */
  async close(): Promise<void> {
    if (this.activeHandle) {
      const handle = this.activeHandle;
      this.activeHandle = null;
      await handle.close();
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

  private registerStaticRoutes(
    app: Express,
    distDir: string,
    hasDist: boolean,
  ): void {
    if (hasDist) {
      app.use(express.static(distDir));
      // SPA-style fallback: any /app/* path serves the shell. Express 5 uses
      // path-to-regexp v8, where a bare `*` is invalid; name the wildcard.
      // The frontend is built with a /app base, so a real asset referenced at
      // /app/assets/x.js lives at dist/assets/x.js - resolve through the
      // prefix before falling back to the shell.
      app.get("/app/*splat", (req: Request, res: Response) => {
        const candidate = path.join(distDir, req.path.replace(/^\/app\//, "/"));
        if (
          candidate.startsWith(distDir) &&
          fs.existsSync(candidate) &&
          fs.statSync(candidate).isFile()
        ) {
          res.sendFile(candidate);
          return;
        }
        res.sendFile(path.join(distDir, "index.html"));
      });
    } else {
      // Every path serves the fallback when the dist is missing, so the
      // browser still gets an explanation instead of a 404.
      app.get("*splat", (_req: Request, res: Response) => {
        res.status(200).type("html").send(this.missingDistPage(distDir));
      });
    }
  }

  private missingDistPage(distDir: string): string {
    return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>tnt web ui</title></head>
  <body>
    <h1>Web UI frontend is not installed</h1>
    <p>The server is running, but no frontend bundle was found at:</p>
    <pre>${distDir}</pre>
    <p>Install it with:</p>
    <pre>npm install tnt-webui</pre>
    <p>Or point TNT_WEBUI_DIST at a built frontend directory.</p>
  </body>
</html>`;
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

/** Constant-time token comparison; lengths are guarded before comparing. */
function tokenEquals(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    presentedBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(presentedBytes, expectedBytes)
  );
}
