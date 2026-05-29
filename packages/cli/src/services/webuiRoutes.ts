import { execFileSync } from "child_process";
import fs from "fs";

import type { Express, Request, Response } from "express";

import { registerSseEventRoute } from "../commands/serve.helpers.js";
import { interactionBroker } from "../permissions/interactionBroker.js";
import { PERMISSION_MODES, type PermissionMode } from "../permissions/types.js";
import { publishAgentEvent } from "../protocol/eventBus.js";
import { getSessionGoal, setSessionGoal } from "../session/index.js";
import { messageQueue } from "../stream/messageQueue.js";
import { formatError } from "../utils/formatError.js";
import { logger } from "../utils/logger.js";

import { buildContextBreakdown } from "./contextBreakdown.js";
import { turnRunnerService } from "./TurnRunnerService.js";
import { getWebUiGitStatus } from "./webuiGit.js";
import {
  installNamedMarketplacePlugin,
  listMarketplaces,
  refreshNamedMarketplace,
} from "./webuiMarketplace.js";
import {
  listInstalledPlugins,
  reloadPlugins,
  setPluginEnabled,
} from "./webuiPlugins.js";
import { registerWebUiAutomationRoutes } from "./webuiRoutes.automations.js";
import { registerWebUiModelRoutes } from "./webuiRoutes.models.js";
import { registerWebUiSessionRoutes } from "./webuiRoutes.sessions.js";
import { applyWebUiSlashCommand, webUiNotice } from "./webuiSlashMessage.js";
import type { WebUiRouteContext } from "./webuiTypes.js";

import { services } from "./index.js";

/**
 * The engine routes the browser talks to. Every handler answers with JSON
 * except the event stream, and every handler stamps the state's activity
 * clock so the SSE keep-alive has something to measure against.
 */
export function registerWebUiRoutes(
  app: Express,
  ctx: WebUiRouteContext,
): void {
  const { options, state } = ctx;

  // GET /state - Return the live engine snapshot.
  app.get("/state", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    res.json(ctx.snapshot());
  });

  // GET /context - Return the token budget breakdown for the current session.
  app.get("/context", async (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    if (options.getContextBreakdown) {
      res.json(await options.getContextBreakdown());
      return;
    }
    const session = ctx.resolveSession();
    const model = services.model?.getState()?.model ?? {
      provider: "openai",
      name: "default",
      model: "default",
    };
    res.json(buildContextBreakdown(session.history, model));
  });

  // GET /git - The checkout, branch, HEAD, latest commit and dirty state the
  // top status menu shows. A non-repository answers with repo: false.
  app.get("/git", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    try {
      res.json(getWebUiGitStatus());
    } catch (error) {
      logger.warn("GET /git failed", error as Error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  // GET /workspaces - The file lists the right-hand workspace rail shows.
  app.get("/workspaces", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const session = ctx.resolveSession();
    const roots = [...new Set([session.workspaceDirectory, process.cwd()])]
      .filter((root): root is string => Boolean(root))
      .map((root) => root.replace(/[/\\]+$/, ""));
    const walk = (directory: string, depth: number): string[] => {
      if (depth > 3) return [];
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return [];
      }
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          files.push(...walk(path, depth + 1));
        } else {
          files.push(path);
        }
      }
      return files;
    };
    res.json({
      workspaces: roots.map((root) => ({
        path: root,
        name: root.split("/").pop() ?? root,
        files: walk(root, 0).slice(0, 300),
      })),
    });
  });

  // GET /workspace/file - The contents of one workspace file, for the file
  // tree's preview. Text files only, size-capped: the tree is a browser over
  // the workspace, not a file server.
  app.get("/workspace/file", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const target = typeof req.query.path === "string" ? req.query.path : "";
    if (target.trim() === "") {
      res.status(400).json({ error: "path is required" });
      return;
    }
    const session = ctx.resolveSession();
    const roots = [...new Set([session.workspaceDirectory, process.cwd()])]
      .filter((root): root is string => Boolean(root))
      .map((root) => fs.realpathSync.native(root.replace(/[/\\]+$/, "")));
    let resolved: string;
    try {
      resolved = fs.realpathSync.native(target);
    } catch {
      res.status(404).json({ error: "file not found" });
      return;
    }
    const inside = roots.some(
      (root) => resolved === root || resolved.startsWith(`${root}/`),
    );
    if (!inside) {
      res.status(403).json({ error: "path is outside the workspace" });
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      res.status(404).json({ error: "file not found" });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: "not a file" });
      return;
    }
    if (stat.size > 256 * 1024) {
      res.status(413).json({ error: "file is too large to preview" });
      return;
    }
    try {
      const content = fs.readFileSync(resolved, "utf-8");
      res.json({
        path: resolved,
        content,
        truncated: content.includes("\uFFFD"),
      });
    } catch {
      // A binary file fails the utf-8 read; say so instead of returning noise.
      res.status(415).json({ error: "not a text file" });
    }
  });

  // GET /git/diff - The working-tree diff of one file, for the git panel's
  // file rows. A path outside the repository 404s rather than diffing air.
  app.get("/git/diff", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const target = typeof req.query.path === "string" ? req.query.path : "";
    if (target.trim() === "") {
      res.status(400).json({ error: "path is required" });
      return;
    }
    try {
      const output = execFileSync(
        "git",
        ["diff", "HEAD", "--no-color", "--", target],
        {
          cwd: process.cwd(),
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
        },
      ).trim();
      res.json({ path: target, diff: output });
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      res.status(400).json({
        error: err.stderr?.trim() ?? err.message ?? "git diff failed",
      });
    }
  });

  // POST /terminal - Run one shell command in the current process cwd and
  // return its combined stdout and stderr. Intentionally synchronous so a
  // short command answers with the full output; long-running commands are
  // better handled in the user's own terminal.
  app.post("/terminal", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { command } = req.body ?? {};
    if (typeof command !== "string" || command.trim() === "") {
      res.status(400).json({ error: "command is required" });
      return;
    }
    try {
      const output = execFileSync("sh", ["-lc", command], {
        cwd: process.cwd(),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      }).trim();
      res.json({ output: output || "(no output)" });
    } catch (error) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      res.json({
        output: err.stdout?.trim(),
        error: err.stderr?.trim() ?? err.message,
      });
    }
  });

  // POST /permission-mode - Switch the session's permission mode. The pill
  // in the status bar posts here when its dropdown picks an entry.
  app.post("/permission-mode", (req: Request, res: Response) => {
    state.lastActivity = Date.now();

    const { mode } = req.body ?? {};
    if (
      typeof mode !== "string" ||
      !PERMISSION_MODES.includes(mode as PermissionMode)
    ) {
      res.status(400).json({
        error: `mode must be one of: ${PERMISSION_MODES.join(", ")}`,
      });
      return;
    }

    services.toolPermissions.switchMode(mode as PermissionMode);
    res.json({
      permissionMode: services.toolPermissions.getState().currentMode,
    });
  });

  // GET /events - Stream the engine event contract as server-sent events.
  registerSseEventRoute(app, state);

  // Conversation history and model editing live in their own modules; both
  // are mounted here so the engine routes read as one list.
  registerWebUiSessionRoutes(app, ctx);
  registerWebUiModelRoutes(app, ctx);

  // POST /workspace/open - Reveal the session's workspace in the platform
  // file manager. The status bar's folder chip posts here; a failure says
  // so rather than pretending the folder opened.
  app.post("/workspace/open", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { path: target } = req.body ?? {};
    if (typeof target !== "string" || target.trim() === "") {
      res.status(400).json({ error: "path is required" });
      return;
    }
    if (!fs.existsSync(target)) {
      res.status(404).json({ error: "path not found" });
      return;
    }
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "explorer"
          : "xdg-open";
    const { spawn } = require("child_process") as {
      spawn: (
        cmd: string,
        args: string[],
        options: { detached: boolean; stdio: "ignore" },
      ) => { unref: () => void; on: (ev: string, cb: () => void) => void };
    };
    const child = spawn(command, [target], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      logger.warn(`Failed to open workspace: ${target}`);
    });
    child.unref();
    res.json({ ok: true });
  });

  // GET /plugins - What this process has installed and loaded: the plugins
  // with the skills, commands and agents each contributes, plus the MCP
  // servers configured for it. The Customize view reads this; a process
  // that has none still answers, so the page renders empty states.
  app.get("/plugins", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    try {
      res.json(listInstalledPlugins());
    } catch (error) {
      logger.warn("GET /plugins failed", error as Error);
      res.json({
        plugins: [],
        skills: [],
        commands: [],
        agents: [],
        mcpServers: {},
        disabledPlugins: [],
        unknownEnabledPlugins: [],
      });
    }
  });

  // POST /plugins/reload - Drop the loader memo and re-read the plugin tree.
  // The Customize page's refresh button uses this after a CLI install or an
  // edit on disk; the listing route itself is deliberately cheap and cached.
  app.post("/plugins/reload", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    try {
      res.json(reloadPlugins());
    } catch (error) {
      logger.warn("POST /plugins/reload failed", error as Error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  // POST /plugins/enabled - Enable or disable one installed plugin. The
  // write lands in this project's settings file, so the page names that file
  // instead of pretending the choice is global.
  app.post("/plugins/enabled", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { name, enabled } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }
    try {
      res.json(setPluginEnabled(name.trim(), enabled));
    } catch (error) {
      res.status(400).json({ error: formatError(error) });
    }
  });

  // GET /worktrees - The repository's checkouts. A process that does not
  // own its session cannot move between them, and says so instead of
  // offering a control that would fail.
  app.get("/worktrees", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const worktrees = options.listWorktrees?.() ?? [];
    res.json({
      available: worktrees.length > 0,
      worktrees,
      current: options.currentWorktree?.() ?? null,
      switchable: Boolean(options.ownsSession),
    });
  });

  // POST /worktree - Move the session into another checkout. The tools read
  // the process's working directory, so this changes where the agent works:
  // only a process that owns its session may do it, and never while a turn
  // is in flight.
  app.post("/worktree", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    if (!options.ownsSession || !options.switchWorktree) {
      res.status(403).json({ error: "this server does not own its session" });
      return;
    }
    if (turnRunnerService.isRunning()) {
      res.status(409).json({ error: "a turn is running" });
      return;
    }

    const { path: target } = req.body ?? {};
    if (typeof target !== "string" || target.trim() === "") {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const worktrees = options.listWorktrees?.() ?? [];
    if (!worktrees.some((worktree) => worktree.path === target)) {
      res.status(400).json({ error: `no worktree at ${target}` });
      return;
    }

    try {
      const worktree = await options.switchWorktree(target);
      publishAgentEvent(ctx.workspaceChangedEvent(worktree));
      res.json({ worktree });
    } catch (error) {
      // The move itself failed - the directory is gone, the session could
      // not be rebuilt - which is the server's problem, not the request's.
      res.status(500).json({ error: formatError(error) });
    }
  });

  // POST /message - Queue a message and make sure somebody drains it.
  app.post("/message", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();

    const { message } = req.body;
    if (typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({ error: "Message field is required" });
    }

    // A message that starts with a slash is a command, not text: the browser
    // dispatches it the way the terminal does, answering print commands into
    // the transcript and reporting the ones whose result needs a picker.
    const sessionId = ctx.resolveSession().sessionId;
    const effect = await applyWebUiSlashCommand(
      message,
      services.config.getState().config,
    );
    if (effect.kind === "answered") {
      if (effect.sessionChanged) {
        publishAgentEvent(ctx.sessionChangedEvent(sessionId));
      }
      if (effect.notice !== null) {
        publishAgentEvent(webUiNotice(sessionId, effect.notice));
      }
      return res.json(effect.payload);
    }

    await messageQueue.enqueueMessage(effect.prompt);

    res.json({
      queued: true,
      position: messageQueue.getQueueLength(),
    });

    // Idempotent: a live loop (the TUI already draining) ignores this; an
    // idle engine starts one that will pick the message up. The no-arg call
    // is what keeps an idle TUI picking up browser messages - the TUI
    // registered its pipeline through setDefaultRunTurn, and by the time a
    // browser message can arrive the turn-end drain loop may have exited.
    turnRunnerService.startDraining(options.runTurn);
  });

  // POST /permission - Approve or reject a pending tool permission. The
  // broker answers the manager directly, so a response for an id that has
  // since expired (or arrived out of order) still resolves the waiting
  // turn; only a missing id is a client error.
  app.post("/permission", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();

    const { requestId, approved, remember } = req.body;

    if (!requestId) {
      return res.status(400).json({ error: "requestId is required" });
    }

    // A "remember" answer carries the session scope: the engine's permission
    // flow holds it, not this route.
    if (approved) {
      interactionBroker.approve(requestId, remember === true);
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

  // POST /goal - Store the session goal the way the TUI's goal pill does.
  // The system message reads the session goal each turn, so a goal set here
  // steers the agent from the next turn on; clearing sends the same shape
  // with an empty string.
  app.post("/goal", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { goal } = req.body ?? {};
    if (goal !== undefined && goal !== null && typeof goal !== "string") {
      res.status(400).json({ error: "goal must be a string" });
      return;
    }
    setSessionGoal(typeof goal === "string" ? goal : undefined);
    res.json({ goal: getSessionGoal() ?? null });
  });

  // GET /goal - The session goal, so a tab that opens later shows the same
  // objective the TUI is working toward rather than an empty pill.
  app.get("/goal", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    res.json({ goal: getSessionGoal() ?? null });
  });

  // POST /question - Answer a pending engine question (the askQuestion tool
  // waits on this through quizService). An unknown id means the question was
  // answered elsewhere already; that is not an error the UI needs to show.
  app.post("/question", (req: Request, res: Response) => {
    state.lastActivity = Date.now();
    const { requestId, answer, isCustomAnswer } = req.body ?? {};
    if (typeof requestId !== "string" || requestId.trim() === "") {
      res.status(400).json({ error: "requestId is required" });
      return;
    }
    if (typeof answer !== "string" || answer.trim() === "") {
      res.status(400).json({ error: "answer is required" });
      return;
    }
    const answered = interactionBroker.answerQuestion(
      requestId,
      answer,
      isCustomAnswer === true,
    );
    res.json({ answered });
  });

  // GET /plugins/marketplaces - What the registered marketplaces carry and
  // which of their plugins are already installed; the marketplace page reads
  // this.
  app.get("/plugins/marketplaces", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    try {
      res.json({ marketplaces: listMarketplaces() });
    } catch (error) {
      logger.warn("GET /plugins/marketplaces failed", error as Error);
      res.json({ marketplaces: [] });
    }
  });

  // POST /plugins/marketplaces/refresh - Re-fetch one marketplace catalogue
  // and answer with the fresh listing.
  app.post(
    "/plugins/marketplaces/refresh",
    async (req: Request, res: Response) => {
      state.lastActivity = Date.now();
      const { name } = req.body ?? {};
      if (typeof name !== "string" || name.trim() === "") {
        res.status(400).json({ error: "name is required" });
        return;
      }
      try {
        res.json({ marketplaces: await refreshNamedMarketplace(name) });
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // POST /plugins/marketplaces/install - Install one plugin from a
  // marketplace and answer with the fresh listing; the loader memo is
  // dropped so the running session sees the new plugin.
  app.post(
    "/plugins/marketplaces/install",
    async (req: Request, res: Response) => {
      state.lastActivity = Date.now();
      const { marketplace, plugin } = req.body ?? {};
      if (typeof marketplace !== "string" || marketplace.trim() === "") {
        res.status(400).json({ error: "marketplace is required" });
        return;
      }
      if (typeof plugin !== "string" || plugin.trim() === "") {
        res.status(400).json({ error: "plugin is required" });
        return;
      }
      try {
        res.json({
          marketplaces: await installNamedMarketplacePlugin(
            marketplace,
            plugin,
          ),
        });
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  registerWebUiAutomationRoutes(app, ctx);

  // POST /exit - Close the HTTP server. Deliberately does not exit the
  // process: the TUI hosts this service in-process and must survive it.
  // Standalone lifecycle (signals, graceful teardown) is Task 5's.
  app.post("/exit", async (_req: Request, res: Response) => {
    res.json({ message: "Web UI server closing", success: true });
    await ctx.close();
  });
}
