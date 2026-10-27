/* eslint-disable max-lines */
import fs from "fs";
import path from "path";

import * as acp from "@agentclientprotocol/sdk";
import type { ModelConfig } from "@tnt/config-yaml";
import type { BaseLlmApi } from "@tnt/openai-adapters";
import type {
  ChatHistoryItem,
  MessageContent,
  MessagePart,
} from "core/index.js";

import { expandMentions } from "../agent/atMentions.js";
import { loadSettings } from "../config/settings.js";
import type { PermissionMode } from "../permissions/types.js";
import { setAdditionalWorkspaceDirectories } from "../permissions/workspacePath.js";
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
  getSessionUsage,
} from "../session/index.js";
import { assertSessionId } from "../session/paths.js";
import { sessionStore } from "../session/store.js";
import { configureConsoleForHeadless, safeStderr } from "../startup/init.js";
import { getVersion } from "../startup/version.js";
import {
  getTerminalRunner,
  setTerminalRunner,
} from "../tools/terminalRunner.js";
import { readTodoState } from "../tools/todo.js";
import { setWorkspaceFileService } from "../tools/workspaceFiles.js";
import { sameDirectory } from "../utils/canonicalPath.js";
import { logger } from "../utils/logger.js";
import {
  countChatHistoryTokens,
  getModelContextLimit,
} from "../utils/tokenizer.js";

import { invalidParams, internalError, sessionNotFound } from "./errors.js";
import { toMcpServerConfig } from "./mcp.js";
import { requestToolPermission } from "./permissions.js";
import { createAcpTerminalRunner } from "./terminal.js";
import { createStdioStream } from "./transport.js";
import {
  eventToUpdate,
  planUpdateFromTodoResult,
  planUpdateFromTodos,
  sendUpdate,
  toolTitle,
  usageUpdate,
} from "./updates.js";

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

function audioFormat(mimeType: string): "wav" | "mp3" {
  const mime = mimeType.toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  throw invalidParams(`Unsupported audio MIME type: ${mimeType}`);
}

function promptContent(blocks: acp.ContentBlock[]): {
  content: MessageContent;
  text: string;
} {
  const parts: MessagePart[] = [];
  const textParts: string[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
      textParts.push(block.text);
      continue;
    }
    if (block.type === "resource_link") {
      const text = `@${block.uri}`;
      parts.push({ type: "text", text });
      textParts.push(text);
      continue;
    }
    if (block.type === "resource") {
      const resource = block.resource;
      const text =
        resource && "text" in resource && typeof resource.text === "string"
          ? resource.text
          : `@${resource?.uri ?? ""}`;
      parts.push({ type: "text", text });
      textParts.push(text);
      continue;
    }
    if (block.type === "image") {
      parts.push({
        type: "imageUrl",
        imageUrl: {
          url: `data:${block.mimeType};base64,${block.data}`,
        },
      });
      continue;
    }
    if (block.type === "audio") {
      parts.push({
        type: "audio",
        audio: {
          data: block.data,
          format: audioFormat(block.mimeType),
        },
      });
      continue;
    }
  }

  if (parts.length === 0) {
    throw invalidParams("Prompt contains no content");
  }
  if (parts.length === 1 && parts[0].type === "text") {
    return { content: parts[0].text, text: textParts[0] ?? "" };
  }
  return { content: parts, text: textParts.join("\n\n") };
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
  // initializeSync updates the service instance; the engine reads the
  // container snapshot in toolExecution, so publish the new policies too.
  serviceContainer.set(
    SERVICE_NAMES.TOOL_PERMISSIONS,
    services.toolPermissions.getState(),
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

function installTerminalRunner(
  state: WorkerState,
  client: acp.AgentContext,
): void {
  setTerminalRunner(
    state.clientCapabilities?.terminal
      ? createAcpTerminalRunner(client, state.sessionId)
      : null,
  );
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

interface PrepareSessionOptions {
  kind: "new" | "load" | "resume";
  cwd: string;
  mcpServers?: acp.McpServer[];
  additionalDirectories?: string[];
  client: acp.AgentContext;
}

async function prepareSession(
  state: WorkerState,
  {
    kind,
    cwd,
    mcpServers = [],
    additionalDirectories = [],
    client,
  }: PrepareSessionOptions,
): Promise<void> {
  // A load/resume of a missing transcript is a protocol error, not a reason to
  // boot services (and possibly fail on model configuration first).
  if (kind !== "new" && !loadSessionById(state.sessionId)) {
    throw sessionNotFound(state.sessionId);
  }

  await ensureBooted(state);
  installWorkspaceFileService(state, client);
  installTerminalRunner(state, client);
  await injectMcpServers(state, mcpServers);

  // The client names the directory the way it saw it and `process.cwd()` names it the way
  // the kernel resolved it; on macOS those differ by `/private`. Compare the directory, not
  // the spelling.
  if (!sameDirectory(cwd, process.cwd())) {
    throw invalidParams(
      `Session cwd ${cwd} does not match the worker cwd ${process.cwd()}`,
    );
  }
  const resolved = path.resolve(cwd);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw invalidParams(`Session cwd does not exist: ${cwd}`);
  }

  for (const directory of additionalDirectories) {
    if (!path.isAbsolute(directory)) {
      throw invalidParams(
        `additionalDirectories must be absolute: ${directory}`,
      );
    }
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw invalidParams(`additionalDirectories does not exist: ${directory}`);
    }
  }
  setAdditionalWorkspaceDirectories(additionalDirectories);

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

function userContentBlocks(content: MessageContent): acp.ContentBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  return content.flatMap((part: MessagePart): acp.ContentBlock[] => {
    if (part.type === "text") {
      return [{ type: "text", text: part.text }];
    }
    if (part.type === "imageUrl") {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(part.imageUrl.url);
      return match
        ? [{ type: "image", mimeType: match[1], data: match[2] }]
        : [];
    }
    if (part.type === "audio") {
      return [
        {
          type: "audio",
          mimeType: `audio/${part.audio.format}`,
          data: part.audio.data,
        },
      ];
    }
    return [];
  });
}

async function replayHistory(
  client: acp.AgentContext,
  sessionId: string,
  history: ChatHistoryItem[],
): Promise<void> {
  for (const item of history) {
    const role = item.message.role;
    if (role === "user") {
      for (const content of userContentBlocks(item.message.content)) {
        await sendUpdate(client, sessionId, {
          sessionUpdate: "user_message_chunk",
          content,
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
          image: true,
          audio: true,
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
    additionalDirectories: string[] = [],
    client: acp.AgentContext,
  ): Promise<acp.NewSessionResponse> => {
    await prepareSession(state, {
      kind,
      cwd,
      mcpServers,
      additionalDirectories,
      client,
    });
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
      context.params.additionalDirectories ?? [],
      context.client,
    );
  });

  app.onRequest(acp.methods.agent.session.load, async (context) => {
    await prepareSession(state, {
      kind: "load",
      cwd: context.params.cwd,
      mcpServers: context.params.mcpServers ?? [],
      additionalDirectories: context.params.additionalDirectories ?? [],
      client: context.client,
    });
    const history = services.chatHistory.getHistory();
    await replayHistory(context.client, sessionId, history);

    const { todos } = readTodoState(history);
    if (todos.length > 0) {
      await sendUpdate(
        context.client,
        sessionId,
        planUpdateFromTodos(todos),
      ).catch((error) => {
        logger.warn("Could not replay the ACP plan", { error });
      });
    }

    try {
      const { model } = modelState();
      const usage = usageUpdate(
        countChatHistoryTokens(history, model),
        getModelContextLimit(model),
        getSessionUsage().totalCost,
      );
      if (usage) await sendUpdate(context.client, sessionId, usage);
    } catch (error) {
      logger.warn("Could not send the loaded ACP usage", { error });
    }

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
      context.params.additionalDirectories ?? [],
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

    const prompt = promptContent(context.params.prompt);

    const { model, llmApi } = modelState();
    const abortController = new AbortController();
    let stopReason: acp.StopReason = "end_turn";
    let interrupted = false;

    services.chatHistory.addUserMessage(
      prompt.content,
      prompt.text ? expandMentions(prompt.text).contextItems : [],
    );

    const queueUpdate = (update: acp.SessionUpdate): void => {
      state.updateChain = state.updateChain
        .then(() => sendUpdate(context.client, sessionId, update))
        .catch((error) => {
          logger.warn("Could not send an ACP session update", { error });
        });
    };

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
        if (update) queueUpdate(update);

        // Every Todo result carries the complete list, so it is also the
        // moment the client's plan changes.
        if (event.type === "tool.finished" && event.toolName === "Todo") {
          const plan = event.result
            ? planUpdateFromTodoResult(event.result)
            : null;
          if (plan) queueUpdate(plan);
        }
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

    const usage = usageUpdate(
      countChatHistoryTokens(services.chatHistory.getHistoryForLLM(), model),
      getModelContextLimit(model),
      getSessionUsage().totalCost,
    );
    if (usage) {
      try {
        await sendUpdate(context.client, sessionId, usage);
      } catch (error) {
        logger.warn("Could not send an ACP usage update", { error });
      }
    }

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
    serviceContainer.set(
      SERVICE_NAMES.TOOL_PERMISSIONS,
      services.toolPermissions.getState(),
    );
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
    serviceContainer.set(SERVICE_NAMES.MODEL, services.model.getState());
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
    await getTerminalRunner()?.dispose?.();
    sessionStore.releaseLease(sessionId);
    return {};
  });

  app.onRequest(acp.methods.agent.session.delete, async () => {
    state.active?.interrupt("user_abort");
    await getTerminalRunner()?.dispose?.();
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
    await getTerminalRunner()
      ?.dispose?.()
      .catch(() => {});
    setTerminalRunner(null);
    setAdditionalWorkspaceDirectories([]);
    await services.mcp.cleanup().catch(() => {});
    sessionStore.releaseLease(sessionId);
    // The parent closed the pipe. Nothing else is allowed to keep this worker
    // alive, so a lingering handle cannot become an orphan.
    setTimeout(() => process.exit(0), 50);
  }
}
