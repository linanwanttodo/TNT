import type { Express, Request, Response } from "express";

import { publishAgentEvent } from "../protocol/eventBus.js";
import { formatError } from "../utils/formatError.js";
import { logger } from "../utils/logger.js";

import {
  addDeclaredModel,
  deleteDeclaredModel,
  readDeclaredModels,
  reorderDeclaredModels,
  testModelConnectivity,
  updateDeclaredModel,
  type ModelConfigInput,
} from "./modelConfigStore.js";
import type { WebUiRouteContext } from "./webuiTypes.js";

import { services } from "./index.js";

/**
 * The model routes: what the status bar's model chip and the Models settings
 * page read, plus the edits that write config.yaml. A process that cannot
 * switch models still answers the listing, so the page renders read-only
 * instead of failing.
 */
export function registerWebUiModelRoutes(
  app: Express,
  ctx: WebUiRouteContext,
): void {
  const { options, state } = ctx;

  // GET /models - The chat models this process can run, plus the declared
  // entries config.yaml carries. The status bar's model chip reads the chat
  // list; the Models settings page reads `declared` and `configPath` to edit
  // the entries themselves.
  app.get("/models", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const models = options.listModels?.() ?? [];
    let declared: ReturnType<typeof readDeclaredModels> = [];
    let configPath: string | null = null;
    try {
      declared = readDeclaredModels();
      configPath =
        (services.config.getState() as { configPath?: string }).configPath ??
        null;
    } catch (error) {
      // A config.yaml that does not parse still answers the chat list; the
      // settings page shows the parse error through its declared-empty state.
      logger.warn(
        "GET /models: reading declared models failed",
        error as Error,
      );
    }
    res.json({
      available: models.length > 0,
      models,
      current: models.find((model) => model.current) ?? null,
      declared,
      configPath,
    });
  });

  // POST /models - Add a model entry to config.yaml and reload the model
  // service, so the new entry appears in the running process's chat list.
  app.post("/models", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const input = req.body as ModelConfigInput | undefined;
    if (!input || typeof input !== "object") {
      res.status(400).json({ error: "a model body is required" });
      return;
    }
    try {
      const result = await addDeclaredModel(input);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /models/update - Patch one entry by name. Omitted fields keep their
  // current values; an empty apiKey keeps the stored one.
  app.post("/models/update", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { name, patch } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!patch || typeof patch !== "object") {
      res.status(400).json({ error: "patch is required" });
      return;
    }
    try {
      const result = await updateDeclaredModel(name, patch);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /models/reorder - Rewrite the declared entries' order to match the
  // submitted list exactly (a permutation check guards both directions), so
  // the drag-and-drop card list persists its ordering.
  app.post("/models/reorder", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { names } = req.body ?? {};
    if (!Array.isArray(names)) {
      res.status(400).json({ error: "names must be a string array" });
      return;
    }
    try {
      const result = await reorderDeclaredModels(names);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /models/delete - Remove one entry by name. If it was the selected
  // model the store hands selection to the first remaining entry.
  app.post("/models/delete", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { name } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    try {
      const result = await deleteDeclaredModel(name);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /models/test - One real completion against the provider, for the
  // form's "Test connection" button. Answers ok/detail/latency either way.
  app.post("/models/test", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const input = req.body as ModelConfigInput | undefined;
    if (!input || typeof input !== "object") {
      res.status(400).json({ error: "a model body is required" });
      return;
    }
    try {
      res.json(await testModelConnectivity(input));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /model - Move the process to another chat model. The switch is the
  // /model screen's recipe, so the next turn runs on the new model.
  app.post("/model", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    if (!options.switchModel) {
      res.status(403).json({
        error: "this server does not offer model switching",
      });
      return;
    }

    const { index } = req.body ?? {};
    if (typeof index !== "number" || !Number.isInteger(index)) {
      res.status(400).json({ error: "index must be an integer" });
      return;
    }

    try {
      const model = await options.switchModel(index);
      publishAgentEvent(ctx.modelChangedEvent(model.name));
      res.json({ model });
    } catch (error) {
      // The index is the request's fault, so a refused switch is the
      // client's mistake: the reason comes back with the status.
      res.status(400).json({ error: formatError(error) });
    }
  });
}
