import type { Express, Request, Response } from "express";

import { getSessionActiveTeam } from "../session/index.js";
import { messageQueue } from "../stream/messageQueue.js";
import { loadTeams } from "../team/loader.js";
import { logger } from "../utils/logger.js";

import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  runDueAutomations,
  setAutomationEnabled,
} from "./automationStore.js";
import { turnRunnerService } from "./TurnRunnerService.js";
import type { WebUiRouteContext } from "./webuiTypes.js";

/**
 * The scheduler and roster routes: the side pane's automations tab and its
 * team tab. Kept beside the engine routes rather than inside them because
 * both read a store the agent never writes during a turn.
 */
export function registerWebUiAutomationRoutes(
  app: Express,
  ctx: WebUiRouteContext,
): void {
  const { options, state } = ctx;

  // GET /automations - The scheduled prompts the registry holds, with their
  // next fire time and run counts, for the side pane's scheduler panel.
  app.get("/automations", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    res.json({ automations: listAutomations() });
  });

  // POST /automations - Create one: exactly one schedule mode (cron, an
  // interval, or a relative one-shot), validated server-side; the first
  // occurrence is computed here and the scheduler picks it up on its tick.
  app.post("/automations", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const {
      title,
      prompt,
      cronExpr,
      interval,
      delayMinutes,
      recurring,
      maxRuns,
      endAt,
    } = req.body ?? {};
    if (typeof title !== "string" || typeof prompt !== "string") {
      res.status(400).json({ error: "title and prompt are required" });
      return;
    }
    try {
      const automation = createAutomation({
        title,
        prompt,
        ...(typeof cronExpr === "string" ? { cronExpr } : {}),
        ...(interval !== null && typeof interval === "object"
          ? {
              interval: {
                unit: (interval as { unit: string }).unit as
                  "minute" | "hour" | "day" | "week",
                value: (interval as { value: number }).value,
              },
            }
          : {}),
        ...(typeof delayMinutes === "number" ? { delayMinutes } : {}),
        recurring: recurring !== false,
        maxRuns: typeof maxRuns === "number" ? maxRuns : undefined,
        endAt: typeof endAt === "number" ? endAt : undefined,
      });
      res.json({ automation, automations: listAutomations() });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /automations/delete - Remove one by id.
  app.post("/automations/delete", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { id } = req.body ?? {};
    if (typeof id !== "string" || id.trim() === "") {
      res.status(400).json({ error: "id is required" });
      return;
    }
    if (!deleteAutomation(id)) {
      res.status(404).json({ error: "automation not found" });
      return;
    }
    res.json({ automations: listAutomations() });
  });

  // POST /automations/enabled - Pause or resume one; resuming re-computes the
  // next occurrence when the stored one has lapsed.
  app.post("/automations/enabled", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { id, enabled } = req.body ?? {};
    if (typeof id !== "string" || typeof enabled !== "boolean") {
      res.status(400).json({ error: "id and enabled are required" });
      return;
    }
    try {
      setAutomationEnabled(id, enabled);
      res.json({ automations: listAutomations() });
    } catch (error) {
      res.status(404).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /automations/run - Fire one now: mark its counters and enqueue its
  // prompt, exactly as the scheduler's tick would.
  app.post("/automations/run", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { id } = req.body ?? {};
    if (typeof id !== "string" || id.trim() === "") {
      res.status(400).json({ error: "id is required" });
      return;
    }
    const automation = listAutomations().find((entry) => entry.id === id);
    if (!automation) {
      res.status(404).json({ error: "automation not found" });
      return;
    }
    try {
      const due = runDueAutomations(
        // Pretend the next occurrence is due, so the store applies its own
        // counters and caps, then queue the prompt that came back.
        (automation.nextRunAt ?? Date.now()) - 1,
      );
      void (async () => {
        for (const entry of due) {
          await messageQueue.enqueueMessage(entry.prompt);
        }
        turnRunnerService.startDraining(options.runTurn);
      })();
      res.json({ automations: listAutomations(), queued: due.length });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /team - The team rosters this workspace knows and the session's
  // active one, for the side pane's team panel. Secrets never travel: only
  // names, descriptions and provenance.
  app.get("/team", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    try {
      const teams = loadTeams(process.cwd()).map((team) => ({
        name: team.name,
        active: team.name === getSessionActiveTeam(),
        members: team.members.map((member) => ({
          name: member.name,
          description: member.description,
          lead: member.lead,
          source: member.source,
        })),
      }));
      res.json({ teams });
    } catch (error) {
      logger.warn("GET /team failed", error as Error);
      res.json({ teams: [] });
    }
  });
}
