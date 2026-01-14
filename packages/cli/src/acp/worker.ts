/* eslint-disable max-lines */
import fs from "fs";
import path from "path";

import * as acp from "@agentclientprotocol/sdk";
import type { ModelConfig } from "@tnt/config-yaml";
import type { BaseLlmApi } from "@tnt/openai-adapters";
import type { ChatHistoryItem } from "core/index.js";

import { expandMentions } from "../agent/atMentions.js";
import { loadSettings } from "../config/settings.js";
import type { PermissionMode } from "../permissions/types.js";
import {
  initializeServices,
  serviceContainer,
  services,
} from "../services/index.js";
import { SERVICE_NAMES, type ModelServiceState } from "../services/types.js";
import {
  startAgentTurn,
  type AgentTurnController,
} from "../session/controller.js";
import {
  saveSession,
  selectSession,
  loadOrCreateSessionById,
  loadSessionById,
} from "../session/index.js";
import { assertSessionId } from "../session/paths.js";
import { sessionStore } from "../session/store.js";
import { configureConsoleForHeadless, safeStderr } from "../startup/init.js";
import { getVersion } from "../startup/version.js";
import { setWorkspaceFileService } from "../tools/workspaceFiles.js";
import { logger } from "../utils/logger.js";

import { invalidParams, internalError, sessionNotFound } from "./errors.js";
import { toMcpServerConfig } from "./mcp.js";
import { requestToolPermission } from "./permissions.js";
import { createStdioStream } from "./transport.js";
import { eventToUpdate, sendUpdate, toolTitle } from "./updates.js";

const MODES: Array<{ id: PermissionMode; name: string }> = [
  { id: "default", name: "Manual" },
  { id: "acceptEdits", name: "Accept edits" },
  { id: "plan", name: "Plan" },
  { id: "auto", name: "Auto" },
  { id: "bypassPermissions", name: "Bypass permissions" },
];

const MODE_IDS = new Set<PermissionMode>(MODES.map((mode) => mode.id));

interface WorkerState {
  sessionId: string;
  configPath?: string;
  booted: boolean;
  prepared: boolean;
  mcpInjected: boolean;
  mode: PermissionMode;
  clientCapabilities?: acp.ClientCapabilities;
  active?: AgentTurnController;
  updateChain: Promise<void>;
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const block = part as {
        type?: string;
        text?: string;
        uri?: string;
        resource?: { text?: string };
      };
      if (block.type === "text") return block.text ?? "";
      if (block.type === "resource_link") return block.uri ?? "";
      if (block.type === "resource") return block.resource?.text ?? "";
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function promptText(blocks: acp.ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "resource_link") return `@${block.uri}`;
      if (block.type === "resource") {
        const resource = block.resource;
        return resource &&
          "text" in resource &&
          typeof resource.text === "string"
          ? resource.text
          : `@${resource?.uri ?? ""}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function modeState(mode: PermissionMode): acp.SessionModeState {
  const current = MODE_IDS.has(mode) ? mode : "default";
  return {
    currentModeId: current,
    availableModes: MODES.map((entry) => ({
      id: entry.id,
      name: entry.name,
    })),
  };
}

function configOptions(): acp.SessionConfigOption[] {
  const models = services.model.getAvailableChatModels();
  if (models.length === 0) return [];
  const current = Math.max(0, services.model.getCurrentModelIndex());
  return [
    {
      type: "select",
      id: "model",
      name: "Model",
      category: "model",
      currentValue: String(current),
      options: models.map((model) => ({
        value: String(model.index),
        name: `${model.name} (${model.provider})`,
      })),
    },
  ];
}

function modelState(): { model: ModelConfig; llmApi: BaseLlmApi } {
  const state = services.model.getState();
  if (!state.model || !state.llmApi) {
    throw internalError("No chat model is configured");
  }
  return { model: state.model, llmApi: state.llmApi };
}

async function ensureBooted(state: WorkerState): Promise<void> {
  if (state.booted) return;

  await initializeServices({
    headless: true,
    skipOnboarding: true,
    options: state.configPath ? { config: state.configPath } : {},
  });

  // initializeServices runs the CLI's headless recipe, which marks chat
  // history as remote and permissions as non-interactive. ACP has a client to
  // ask, so both are reset before the first turn.
  await services.chatHistory.initialize(undefined, false);

  const defaultMode = (loadSettings().defaultMode ??
    "default") as PermissionMode;
  state.mode = MODE_IDS.has(defaultMode) ? defaultMode : "default";
  services.toolPermissions.initializeSync(
    { isHeadless: false, mode: state.mode },
    services.agentFile.getState(),
    services.mcp.getState(),
  );

  // Resolve the model once so a missing key fails at session creation rather
  // than halfway through the first prompt.
  await serviceContainer.get<ModelServiceState>(SERVICE_NAMES.MODEL);
  state.booted = true;
}

function installWorkspaceFileService(
  state: WorkerState,
  client: acp.AgentContext,
): void {
  const capabilities = state.clientCapabilities?.fs;
  if (!capabilities?.readTextFile && !capabilities?.writeTextFile) {
    setWorkspaceFileService(null);
    return;
  }

  setWorkspaceFileService({
    readTextFile: async (absolutePath) => {
      if (!capabilities.readTextFile) {
        throw new Error("The editor does not support reading files");
      }
      const response = await client.request(
        acp.methods.client.fs.readTextFile,
        { sessionId: state.sessionId, path: absolutePath },
      );
      return response.content;
    },
    writeTextFile: async (absolutePath, content) => {
      if (!capabilities.writeTextFile) {
        throw new Error("The editor does not support writing files");
      }
      await client.request(acp.methods.client.fs.writeTextFile, {
        sessionId: state.sessionId,
        path: absolutePath,
        content,
      });
    },
  });
}

async function injectMcpServers(
  state: WorkerState,
  servers: acp.McpServer[],
): Promise<void> {
  if (state.mcpInjected || servers.length === 0) return;
  state.mcpInjected = true;
  for (const server of servers) {
    try {
      await services.mcp.addServer(toMcpServerConfig(server));
    } catch (error) {
      logger.warn("Could not connect an ACP MCP server", {
        name: server.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function prepareSession(
  state: WorkerState,
  kind: "new" | "load" | "resume",
  cwd: string,
  mcpServers: acp.McpServer[] = [],
  client: acp.AgentContext,
): Promise<void> {
  // A load/resume of a missing transcript is a protocol error, not a reason to
  // boot services (and possibly fail on model configuration first).
  if (kind !== "new" && !loadSessionById(state.sessionId)) {
    throw sessionNotFound(state.sessionId);
  }

  await ensureBooted(state);
  installWorkspaceFileService(state, client);
  await injectMcpServers(state, mcpServers);

  const resolved = path.resolve(cwd);
  if (resolved !== path.resolve(process.cwd())) {
    throw invalidParams(
      `Session cwd ${cwd} does not match the worker cwd ${process.cwd()}`,
    );
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw invalidParams(`Session cwd does not exist: ${cwd}`);
  }

  const session =
    kind === "new"
      ? loadOrCreateSessionById(state.sessionId, [], {
          source: "acp",
          persistEmpty: true,
          lease: true,
        })
      : selectSession(state.sessionId);

  if (!session) throw sessionNotFound(state.sessionId);

  await services.chatHistory.initialize(session, false);
  state.prepared = true;
}

async function replayHistory(
  client: acp.AgentContext,
  sessionId: string,
  history: ChatHistoryItem[],
): Promise<void> {
  for (const item of history) {
    const role = item.message.role;
    if (role === "user") {
      const text = textOfContent(item.message.content);
      if (text) {
        await sendUpdate(client, sessionId, {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text },
        });
      }
      continue;
    }
    if (role === "assistant") {
      const text = textOfContent(item.message.content);
      if (text) {
        await sendUpdate(client, sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        });
      }
      for (const tool of item.toolCallStates ?? []) {
        const output = (tool.output ?? [])
          .map((entry) =>
            String((entry as { content?: unknown }).content ?? ""),
          )
          .join("\n");
        await sendUpdate(client, sessionId, {
          sessionUpdate: "tool_call",
          toolCallId: tool.toolCallId,
          title: toolTitle(tool.toolCallId, {}),
          name: tool.toolCallId,
          kind: "other",
          status:
            tool.status === "done"
              ? "completed"
              : tool.status === "errored" || tool.status === "canceled"
                ? "failed"
                : "in_progress",
          content: output
            ? [
                {
                  type: "content",
                  content: { type: "text", text: output },
                },
              ]
            : undefined,
        });
      }
    }
  }
}

export async function runAcpWorker(
  sessionId?: string,
  configPath?: string,
  sessionCwd?: string,
): Promise<void> {
  configureConsoleForHeadless(true);
  logger.configureHeadlessMode(true);

  if (!sessionId) {
    safeStderr("tnt --acp-worker requires --session-id\n");
    process.exitCode = 1;
    return;
  }
  try {
    assertSessionId(sessionId);
  } catch {
    safeStderr(`Invalid ACP session id: ${sessionId}\n`);
    process.exitCode = 1;
    return;
  }

  // The supervisor starts the worker from the package directory so a tsx
  // loader resolves; the session owns the cwd that tools and config see.
  if (sessionCwd) {
    try {
      process.chdir(path.resolve(sessionCwd));
    } catch (error) {
      safeStderr(
        `Could not enter ACP session cwd ${sessionCwd}: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const state: WorkerState = {
    sessionId,
    configPath,
    booted: false,
    prepared: false,
    mcpInjected: false,
    mode: "default",
    updateChain: Promise.resolve(),
  };

  const app = acp.agent({ name: "tnt-worker" });

  app.onRequest(acp.methods.agent.initialize, async (context) => {
    state.clientCapabilities = context.params.clientCapabilities;
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: {
        name: "tnt",
        title: "TNT CLI",
        version: getVersion(),
      },
      authMethods: [],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          embeddedContext: true,
        },
      },
    } satisfies acp.InitializeResponse;
  });

  app.onRequest(acp.methods.agent.authenticate, async () => ({}));

  const openSession = async (
    kind: "new" | "load" | "resume",
    cwd: string,
    mcpServers: acp.McpServer[] = [],
    client: acp.AgentContext,
  ): Promise<acp.NewSessionResponse> => {
    await prepareSession(state, kind, cwd, mcpServers, client);
    return {
      sessionId,
      modes: modeState(state.mode),
      configOptions: configOptions(),
    };
  };

  app.onRequest(acp.methods.agent.session.new, async (context) => {
    return await openSession(
      "new",
      context.params.cwd,
      context.params.mcpServers ?? [],
      context.client,
    );
  });

  app.onRequest(acp.methods.agent.session.load, async (context) => {
    await prepareSession(
      state,
      "load",
      context.params.cwd,
      context.params.mcpServers ?? [],
      context.client,
    );
    await replayHistory(
      context.client,
      sessionId,
      services.chatHistory.getHistory(),
    );
    return {
      modes: modeState(state.mode),
      configOptions: configOptions(),
    };
  });

  app.onRequest(acp.methods.agent.session.resume, async (context) => {
    return await openSession(
      "resume",
      context.params.cwd,
      context.params.mcpServers ?? [],
      context.client,
    );
  });

  app.onNotification(acp.methods.agent.session.cancel, async () => {
    state.active?.interrupt("user_abort");
  });

  app.onRequest(acp.methods.agent.session.prompt, async (context) => {
    if (!state.prepared) {
      throw invalidParams("Open a session before prompting");
    }
    if (state.active) {
      throw invalidParams("Session already has an active prompt");
    }

    const text = promptText(context.params.prompt);
    if (!text.trim()) {
      throw invalidParams("Prompt contains no text");
    }

    const { model, llmApi } = modelState();
    const abortController = new AbortController();
    let stopReason: acp.StopReason = "end_turn";
    let interrupted = false;

    services.chatHistory.addUserMessage(
      text,
      expandMentions(text).contextItems,
    );

    const controller = startAgentTurn({
      sessionId,
      chatHistory: services.chatHistory.getHistoryForLLM(),
      model,
      llmApi,
      abortController,
      callbacks: {
        onToolPermissionRequest: (
          toolName,
          toolArgs,
          requestId,
          _preview,
          toolCallId,
        ) => {
          requestToolPermission({
            client: context.client,
            sessionId,
            toolName,
            toolArgs,
            requestId,
            toolCallId,
            signal: abortController.signal,
          });
        },
      },
      runOverrides: {
        isHeadless: false,
        mode: state.mode,
      },
      onEvent: (event) => {
        const update = eventToUpdate(event, {
          notices: Boolean(state.clientCapabilities?.session?.notices),
          compaction: Boolean(state.clientCapabilities?.session?.compaction),
        });
        if (!update) return;
        state.updateChain = state.updateChain
          .then(() => sendUpdate(context.client, sessionId, update))
          .catch((error) => {
            logger.warn("Could not send an ACP session update", { error });
          });
      },
    });

    state.active = controller;
    try {
      await controller.done;
    } catch (error) {
      if (abortController.signal.aborted) {
        stopReason = "cancelled";
      } else {
        throw internalError(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      state.active = undefined;
      interrupted = abortController.signal.aborted;
    }

    await state.updateChain;
    saveSession();
    if (interrupted && stopReason === "end_turn") stopReason = "cancelled";
    return { stopReason } satisfies acp.PromptResponse;
  });

  app.onRequest(acp.methods.agent.session.setMode, async (context) => {
    const mode = context.params.modeId as PermissionMode;
    if (!MODE_IDS.has(mode)) {
      throw invalidParams(`Unknown mode: ${context.params.modeId}`);
    }
    state.mode = mode;
    services.toolPermissions.switchMode(mode);
    await sendUpdate(context.client, sessionId, {
      sessionUpdate: "current_mode_update",
      currentModeId: mode,
    });
    return {};
  });

  app.onRequest(acp.methods.agent.session.setConfigOption, async (context) => {
    if (context.params.configId !== "model") {
      throw invalidParams(`Unknown config option: ${context.params.configId}`);
    }
    const index = Number.parseInt(String(context.params.value), 10);
    if (!Number.isInteger(index) || index < 0) {
      throw invalidParams(
        `Invalid model index: ${String(context.params.value)}`,
      );
    }
    await services.model.switchModel(index);
    const options = configOptions();
    await sendUpdate(context.client, sessionId, {
      sessionUpdate: "config_option_update",
      configOptions: options,
    });
    return { configOptions: options };
  });

  app.onRequest(acp.methods.agent.session.list, async () => {
    const meta = sessionStore.getMeta(sessionId);
    return {
      sessions: meta
        ? [
            {
              sessionId,
              cwd: meta.workspaceDirectory,
              title: meta.title,
              updatedAt: meta.updatedAt,
            },
          ]
        : [],
    };
  });

  app.onRequest(acp.methods.agent.session.close, async () => {
    state.active?.interrupt("user_abort");
    sessionStore.releaseLease(sessionId);
    return {};
  });

  app.onRequest(acp.methods.agent.session.delete, async () => {
    state.active?.interrupt("user_abort");
    sessionStore.delete(sessionId, { force: true });
    return {};
  });

  const connection = app.connect(createStdioStream());
  process.stdin.once("end", () => connection.close());
  process.stdin.once("close", () => connection.close());
  try {
    await connection.closed;
  } finally {
    state.active?.interrupt("shutdown");
    setWorkspaceFileService(null);
    await services.mcp.cleanup().catch(() => {});
    sessionStore.releaseLease(sessionId);
    // The parent closed the pipe. Nothing else is allowed to keep this worker
    // alive, so a lingering handle cannot become an orphan.
    setTimeout(() => process.exit(0), 50);
  }
}
