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
}

export interface WebUiHandle {
  /** The port the server actually bound, after probing. */
  port: number;
  /** Placeholder until Task 4 wires the token gate. */
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
 * Task 4 adds token auth as middleware on this app; nothing gates the routes
 * yet.
 */
export class WebUiService {
  private activeHandle: WebUiHandle | null = null;

  async start(options: WebUiServiceOptions = {}): Promise<WebUiHandle> {
    const app = express();
    app.use(express.json());

    // registerSseEventRoute only touches lastActivity on the state it is
    // handed; the routes below do the same, so a minimal object carries them.
    const state = {
      lastActivity: Date.now(),
    } as ServerState;

    const distDir =
      options.distDir ??
      process.env.TNT_WEBUI_DIST ??
      path.resolve(process.cwd(), "node_modules", "tnt-webui", "dist");

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
    this.registerStaticRoutes(app, distDir);

    const handle = await this.listen(app, options);
    this.activeHandle = handle;

    return handle;
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

  private registerStaticRoutes(app: Express, distDir: string): void {
    const hasDist = fs.existsSync(distDir);

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
          token: crypto.randomBytes(32).toString("base64url"),
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
