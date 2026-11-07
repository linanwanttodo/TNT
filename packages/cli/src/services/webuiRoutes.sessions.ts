import type { Express, Request, Response } from "express";

import { publishAgentEvent } from "../protocol/eventBus.js";
import {
  getCurrentSession,
  listSessions,
  selectSession,
  startNewSession,
  updateSessionTitle,
} from "../session/index.js";
import { assertSessionId } from "../session/paths.js";

import {
  deleteStoredSession,
  renameStoredSession,
} from "./webuiSessionStore.js";
import type { WebUiRouteContext } from "./webuiTypes.js";

/**
 * The conversation-history routes: list, start, switch, rename and delete.
 *
 * Every mutating one refuses unless this process owns its session, because the
 * TUI's in-process server shares the terminal's live conversation and a switch
 * from the browser would desync it.
 */
export function registerWebUiSessionRoutes(
  app: Express,
  ctx: WebUiRouteContext,
): void {
  const { options, state } = ctx;

  // GET /sessions - The conversation list the sidebar renders. The store's
  // metadata cache carries the title and timestamp, so listing does not
  // open every transcript.
  app.get("/sessions", async (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const sessions = await listSessions();
    res.json({
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        title: session.title,
        workspaceDirectory: session.workspaceDirectory,
        dateCreated: session.dateCreated,
        updatedAt: session.updatedAt,
      })),
    });
  });

  // POST /session/new - Start a fresh session in this process and return the
  // same snapshot shape GET /state reports, so the frontend re-hydrates from
  // the one response. The SSE stream carries a session.changed event so
  // every connected tab drops the previous conversation. Only a process
  // that owns its session may switch it; the TUI's in-process server
  // refuses rather than desyncing the terminal.
  app.post("/session/new", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    if (!options.ownsSession) {
      res.status(403).json({ error: "this server does not own its session" });
      return;
    }
    const session = (options.createNewSession ?? startNewSession)();
    publishAgentEvent(ctx.sessionChangedEvent(session.sessionId));
    res.json(ctx.snapshotFor(session));
  });

  // POST /session/select - Point the process at a saved conversation.
  // Sessions persist between commands, so switching re-leases the target
  // transcript; the response snapshot carries its history.
  app.post("/session/select", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    if (!options.ownsSession) {
      res.status(403).json({ error: "this server does not own its session" });
      return;
    }

    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    // HTTP input reaches the session store's file paths; the id format is
    // policed here at the boundary as well as inside the store.
    try {
      assertSessionId(sessionId);
    } catch {
      res.status(400).json({ error: "sessionId is malformed" });
      return;
    }

    const session = selectSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }

    publishAgentEvent(ctx.sessionChangedEvent(session.sessionId));
    res.json(ctx.snapshotFor(session));
  });

  // POST /session/rename - Set a conversation's title. Renaming another
  // session than the live one rewrites its meta.json directly; the live
  // one goes through the manager so the in-memory copy stays in step.
  app.post("/session/rename", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { sessionId, title } = req.body ?? {};
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    // The title lands inside a JSON file, the id inside file paths; the id
    // format is policed at the boundary as well as inside the store.
    try {
      assertSessionId(sessionId);
    } catch {
      res.status(400).json({ error: "sessionId is malformed" });
      return;
    }
    if (typeof title !== "string" || title.trim() === "") {
      res.status(400).json({ error: "title is required" });
      return;
    }

    try {
      if (getCurrentSession().sessionId === sessionId) {
        updateSessionTitle(title.trim());
      } else {
        renameStoredSession(sessionId, title.trim());
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /session/delete - Remove a conversation from disk. The live one
  // is refused: switch away first, then delete. A missing session 404s.
  app.post("/session/delete", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    try {
      assertSessionId(sessionId);
    } catch {
      res.status(400).json({ error: "sessionId is malformed" });
      return;
    }

    try {
      if (getCurrentSession().sessionId === sessionId) {
        res.status(409).json({
          error: "switch to another session before deleting this one",
        });
        return;
      }
      if (!deleteStoredSession(sessionId)) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
