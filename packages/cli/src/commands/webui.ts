import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";
import type { ChatHistoryItem } from "core/index.js";
import type { Session } from "core/index.js";

import { expandMentions } from "../agent/atMentions.js";
import { constructSystemMessage } from "../agent/systemMessage.js";
import { processCommandFlags } from "../config/flagProcessor.js";
import { globalDir } from "../config/globalDir.js";
import { loadSettings } from "../config/settings.js";
import { t } from "../i18n/index.js";
import {
  getService,
  initializeServices,
  SERVICE_NAMES,
  services,
  type ConfigServiceState,
  type ModelServiceState,
} from "../services/index.js";
import { webUiService } from "../services/WebUiService.js";
import { runAgentTurn } from "../session/controller.js";
import { createSession, loadSession } from "../session/index.js";
import { messageQueue, type QueuedMessage } from "../stream/messageQueue.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { gracefulExit, updateAgentMetadata } from "../utils/exit.js";
import { formatError } from "../utils/formatError.js";
import { logger } from "../utils/logger.js";

import {
  checkAgentComplete,
  finishServedTurn,
  prepareServedPrompt,
  removePartialAssistantMessage,
  startServedSession,
  titleServeSessionIfUntitled,
  type ServerState,
} from "./serve.helpers.js";

export interface WebuiCommandOptions {
  port?: string;
  host?: string;
  resume?: boolean;
  open?: boolean;
  persistToken?: boolean;
}

/**
 * Validates that a --host value keeps the server on loopback. The v1 surface
 * is a local dev tool with a bearer-equivalent token; a LAN bind is the
 * /mobile phase's work, together with TLS.
 */
export function validateWebuiHost(
  host: string | undefined,
): { valid: true } | { valid: false; error: string } {
  if (host === undefined || host === "127.0.0.1" || host === "localhost") {
    return { valid: true };
  }
  return {
    valid: false,
    error: `webui binds loopback only in v1 (got "${host}"). Use 127.0.0.1 or localhost; LAN exposure arrives with the /mobile phase.`,
  };
}

/** Writes the pid of the long-running webui process for `tnt webui stop`. */
function writePidFile(pid: number): string {
  const file = path.join(globalDir(), "webui.pid");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(pid), { mode: 0o644 });
  return file;
}

function readPidFile(): number | null {
  const file = path.join(globalDir(), "webui.pid");
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function removePidFile(): void {
  try {
    fs.unlinkSync(path.join(globalDir(), "webui.pid"));
  } catch {
    // Nothing to clean up.
  }
}

export async function stopWebuiProcess(): Promise<boolean> {
  const pid = readPidFile();
  if (pid === null) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    removePidFile();
    return false;
  }
  removePidFile();
  return true;
}

/**
 * One turn of the standalone webui session, mirroring serve's processMessages
 * body: hook gating, mention expansion, streaming with tool calls, session
 * naming. Interruption belongs to the abort signal the drain loop provides.
 */
async function runStandaloneTurn(
  state: ServerState,
  llmApi: any,
  model: any,
  queued: QueuedMessage,
  _signal: AbortSignal,
): Promise<void> {
  const prepared = await prepareServedPrompt(queued.message);
  if (prepared.blocked) {
    const reason = prepared.blockReason ?? "blocked by UserPromptSubmit hook";
    logger.info("Served prompt blocked by a UserPromptSubmit hook");
    try {
      services.chatHistory.addAssistantMessage(reason);
    } catch {
      state.session.history.push({
        message: { role: "assistant", content: reason },
        contextItems: [],
      });
    }
    return;
  }

  const mentionItems = expandMentions(prepared.text).contextItems;
  try {
    services.chatHistory.addUserMessage(prepared.text, mentionItems);
  } catch {
    state.session.history.push({
      message: { role: "user", content: prepared.text },
      contextItems: mentionItems,
    });
  }

  try {
    const response = await runAgentTurn({
      chatHistory: state.session.history,
      model,
      llmApi,
      abortController: new AbortController(),
    });

    await titleServeSessionIfUntitled(
      state.session,
      response,
      llmApi,
      state.model,
    );
    await finishServedTurn(response);

    try {
      const history = services.chatHistory?.getHistory();
      await updateAgentMetadata({
        history,
        isComplete: checkAgentComplete(history),
      });
    } catch (metadataErr) {
      logger.debug(
        "Failed to update metadata after turn (non-critical)",
        metadataErr as any,
      );
    }
  } catch (e: any) {
    if (e.name === "AbortError") {
      logger.debug("Response interrupted");
      removePartialAssistantMessage(state.session.history);
    } else {
      logger.error(`Error: ${formatError(e)}`);
      const errorMessage = `Error: ${formatError(e)}`;
      try {
        services.chatHistory.addAssistantMessage(errorMessage);
      } catch {
        state.session.history.push({
          message: { role: "assistant", content: errorMessage },
          contextItems: [],
        });
      }
    }
  }
}

/**
 * The `tnt webui` entrypoint: a headless process hosting the web UI against
 * its own session. It is serve's sibling, not a second engine: turns run
 * through the same stream pipeline serve uses, the shared drain loop owns
 * ordering, and the HTTP surface is WebUiService.
 */
export async function webui(
  prompt: string | undefined,
  options: WebuiCommandOptions,
): Promise<void> {
  const hostCheck = validateWebuiHost(options.host);
  if (!hostCheck.valid) {
    console.error(chalk.red(hostCheck.error));
    await gracefulExit(1);
    return;
  }

  const { permissionOverrides, warnings } = processCommandFlags(
    options as any,
    loadSettings().defaultMode,
  );
  for (const warning of warnings) console.warn(warning);

  await initializeServices({
    options: options as any,
    toolPermissionOverrides: permissionOverrides,
    headless: true,
  });

  const [configState, modelState] = await Promise.all([
    getService<ConfigServiceState>(SERVICE_NAMES.CONFIG),
    getService<ModelServiceState>(SERVICE_NAMES.MODEL),
  ]);

  if (!configState.config || !modelState.llmApi || !modelState.model) {
    console.error(chalk.red(t("serve.servicesUnavailable")));
    await gracefulExit(1);
    return;
  }

  const { llmApi, model } = {
    llmApi: modelState.llmApi,
    model: modelState.model,
  };

  const initialHistory: ChatHistoryItem[] = [];
  const systemMessage = await constructSystemMessage(
    "default",
    undefined,
    undefined,
    true,
    undefined,
  );
  if (systemMessage) {
    initialHistory.push({
      message: { role: "system" as const, content: systemMessage },
      contextItems: [],
    });
  }

  const resumed = options.resume ? loadSession() : null;
  const session: Session = resumed ?? createSession(initialHistory);

  try {
    await services.chatHistory.initialize(session, false);
  } catch {
    logger.debug("ChatHistoryService init failed; stream continues on arrays");
  }

  const state: ServerState = {
    session,
    config: configState.config,
    model,
    isProcessing: false,
    lastActivity: Date.now(),
    currentAbortController: null,
    serverRunning: true,
    pendingPermission: null,
  };

  telemetryService.recordSessionStart();
  telemetryService.startActiveTime();
  await startServedSession(false, model?.model);

  const handle = await webUiService.start({
    port: options.port ? Number.parseInt(options.port, 10) : undefined,
    persistToken: options.persistToken,
    runTurn: (queued, signal) =>
      runStandaloneTurn(state, llmApi, model, queued, signal),
  });

  const url = `http://127.0.0.1:${handle.port}/#token=${handle.token}`;
  console.log(chalk.green(t("webui.listening", { url })));
  console.log(chalk.dim(t("webui.stopHint")));
  writePidFile(process.pid);

  if (prompt && prompt.trim() !== "") {
    await messageQueue.enqueueMessage(prompt);
  }

  const shutdown = async (code: number) => {
    state.serverRunning = false;
    removePidFile();
    await webUiService.close();
    telemetryService.stopActiveTime();
    await gracefulExit(code);
  };

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  // The long-running promise: this process serves until signaled. The
  // interval only keeps the event loop alive; all work happens in handlers.
  await new Promise<void>(() => {});
}
