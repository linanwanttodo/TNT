/* eslint-disable max-lines -- the app-server method map, event bridge and interaction bridge share one connection-scoped adapter. */
import { randomUUID } from "node:crypto";
import path from "node:path";

import { Emitter, type Event } from "@zcode/rpc";
import {
  IZCodeAgentService,
  type ZCodeAgentCreateSessionParams,
  type ZCodeAgentInitializeResult,
  type ZCodeAgentReadSessionParams,
  type ZCodeAgentResumeSessionParams,
  type ZCodeAgentSendPromptParams,
  type ZCodeAgentServiceEvent,
  type ZCodeAgentSessionSubscribeParams,
  type ZCodeAgentSessionTarget,
  type ZCodeAgentSetModelParams,
  type ZCodeAgentWorkspaceTarget,
} from "@zcode/services";
import type {
  ZCodeMessageWithParts,
  ZCodePermissionRequestParams,
  ZCodeSessionEvent,
  ZCodeSessionInfo,
  ZCodeSessionSendResult,
  ZCodeSessionStateSnapshot,
  ZCodeUserInputRequestParams,
  ZCodeUserInputResponse,
} from "@zcode/shared";
import {
  zcodePermissionRequestParamsSchema,
  zcodeProtocolMethods,
  zcodeUserInputRequestParamsSchema,
} from "@zcode/shared";
import type {
  ClientHello,
  CommandAck,
  CommandEnvelope,
  ConversationTopicWireCandidate,
  HelloMessage,
  V4ConversationResyncResult,
  V4ConversationSubscribeResult,
} from "@zcode/shared/zcode-protocol-v4";
import {
  clientHelloSchema,
  commandPayloadSchemas,
  conversationTopic,
  V4_METHODS,
  V4_NOTIFICATIONS,
  V4_WIRE_PROTOCOL_VERSION,
} from "@zcode/shared/zcode-protocol-v4";

import { logger } from "../../utils/logger.js";
import type {
  EngineNotification,
  EngineNotificationListener,
  EngineRequestHandler,
} from "../engineClient.js";

import { stubServiceWith } from "./stubs.js";

const CLIENT_MODE = "desktop-continuous" as const;
const SESSION_EVENT_NOTIFICATION = "session/event";

type AgentListSessionsParams = Parameters<
  IZCodeAgentService["listSessions"]
>[0];
type AgentReadMessagesParams = Parameters<
  IZCodeAgentService["readSessionMessages"]
>[0];
type AgentConversationSubscribeParams = Parameters<
  IZCodeAgentService["subscribeConversationV4"]
>[0];
type AgentConversationResyncParams = Parameters<
  IZCodeAgentService["resyncConversationV4"]
>[0];
type AgentConversationUnsubscribeParams = Parameters<
  IZCodeAgentService["unsubscribeConversationV4"]
>[0];
type AgentConversationCommandParams = Parameters<
  IZCodeAgentService["sendConversationCommandV4"]
>[0];

export interface ZcodeEngineRegistry {
  dispatch(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
  subscribe(
    candidate: string,
    listener: EngineNotificationListener,
  ): Promise<() => void>;
  setRequestHandler(
    candidate: string,
    handler: EngineRequestHandler | null,
  ): Promise<void>;
}

interface EngineWorkspaceRef {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  workspaceKey: string;
}

interface WorkspaceState {
  readonly sessionEvents: Emitter<ZCodeAgentServiceEvent>;
  readonly frames: Emitter<ConversationTopicWireCandidate>;
  unsubscribe: (() => void) | null;
  installing: Promise<void> | null;
}

interface PendingInteraction {
  readonly workspacePath: string;
  readonly event:
    | { type: "permission.request"; request: ZCodePermissionRequestParams }
    | { type: "userInput.request"; request: ZCodeUserInputRequestParams };
  readonly resolve: (value: unknown) => void;
}

interface EngineSessionSubscribeResult {
  eventSeq: number;
  events: ZCodeSessionEvent[];
  snapshot?: ZCodeSessionStateSnapshot;
}

function workspaceRef(target: ZCodeAgentWorkspaceTarget): EngineWorkspaceRef {
  return {
    workspacePath: target.workspacePath,
    ...(target.workspaceIdentity
      ? { workspaceIdentity: target.workspaceIdentity }
      : {}),
    ...(target.remoteSessionId
      ? { remoteSessionId: target.remoteSessionId }
      : {}),
    workspaceKey: target.workspaceIdentity || target.workspacePath,
  };
}

function createSessionParams(
  params: ZCodeAgentCreateSessionParams,
): Record<string, unknown> {
  return {
    workspace: workspaceRef(params),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.parentSessionId
      ? { parentSessionId: params.parentSessionId }
      : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.persistence ? { persistence: params.persistence } : {}),
    ...(params.thoughtLevel ? { thoughtLevel: params.thoughtLevel } : {}),
    ...(params.additionalDirectories
      ? { additionalDirectories: params.additionalDirectories }
      : {}),
    ...(params.titleGenerationEnabled === undefined
      ? {}
      : { titleGenerationEnabled: params.titleGenerationEnabled }),
    ...(params.mcpServers ? { mcpServers: params.mcpServers } : {}),
    ...(params.toolAllowlist ? { toolAllowlist: params.toolAllowlist } : {}),
    ...(params.toolDenylist ? { toolDenylist: params.toolDenylist } : {}),
    ...(params.importedHistory
      ? { importedHistory: params.importedHistory }
      : {}),
  };
}

function resumeSessionParams(
  params: ZCodeAgentResumeSessionParams,
): Record<string, unknown> {
  return {
    sessionId: params.sessionId,
    workspace: workspaceRef(params),
    ...(params.additionalDirectories
      ? { additionalDirectories: params.additionalDirectories }
      : {}),
    ...(params.thoughtLevel ? { thoughtLevel: params.thoughtLevel } : {}),
    ...(params.mcpServers ? { mcpServers: params.mcpServers } : {}),
    ...(params.toolAllowlist ? { toolAllowlist: params.toolAllowlist } : {}),
    ...(params.toolDenylist ? { toolDenylist: params.toolDenylist } : {}),
  };
}

function listSessionsParams(
  params: AgentListSessionsParams,
): Record<string, unknown> {
  return {
    workspace: workspaceRef(params),
    ...(params.sessionIds ? { sessionIds: params.sessionIds } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
  };
}

function readSessionParams(
  params: ZCodeAgentReadSessionParams,
): Record<string, unknown> {
  return {
    sessionId: params.sessionId,
    ...(params.deliveryKind ? { deliveryKind: params.deliveryKind } : {}),
    ...(params.messageLimit ? { messageLimit: params.messageLimit } : {}),
    ...(params.afterSeq === undefined ? {} : { afterSeq: params.afterSeq }),
    ...(params.contentProfile ? { contentProfile: params.contentProfile } : {}),
  };
}

function readMessagesParams(
  params: AgentReadMessagesParams,
): Record<string, unknown> {
  return {
    sessionId: params.sessionId,
    ...(params.afterMessageId ? { afterMessageId: params.afterMessageId } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
  };
}

function sendPromptParams(
  params: ZCodeAgentSendPromptParams,
): Record<string, unknown> {
  // The app-server send schema is strict and only models the fields it can
  // execute; host-only attribution fields are dropped at this boundary.
  return {
    sessionId: params.sessionId,
    content: params.content,
    ...(params.modelSelection ? { modelSelection: params.modelSelection } : {}),
    ...(params.modelExecution ? { modelExecution: params.modelExecution } : {}),
    ...(params.inputId ? { inputId: params.inputId } : {}),
    ...(params.queryId ? { queryId: params.queryId } : {}),
    ...(params.attachments ? { attachments: params.attachments } : {}),
    ...(params.browserAmbientContext
      ? { browserAmbientContext: params.browserAmbientContext }
      : {}),
    ...(params.expectedRevision === undefined
      ? {}
      : { expectedRevision: params.expectedRevision }),
    ...(params.expectedProviderRevision
      ? { expectedProviderRevision: params.expectedProviderRevision }
      : {}),
    ...(params.botDeliveryTarget
      ? { botDeliveryTarget: params.botDeliveryTarget }
      : {}),
    ...(params.toolDenylist ? { toolDenylist: params.toolDenylist } : {}),
  };
}

function commandSessionId(event: ZCodeAgentServiceEvent): string | null {
  switch (event.type) {
    case "session.event":
      return event.event.sessionId;
    case "permission.request":
      return event.request.sessionId;
    case "userInput.request":
      return event.request.sessionId;
    case "snapshot":
      return event.snapshot.session.sessionId;
    default:
      return null;
  }
}

function isPermissionAllowed(answer: {
  optionId?: string;
  action?: "accept" | "decline" | "cancel";
}): boolean | null {
  if (
    answer.optionId === "allow_always" ||
    answer.optionId === "allow_once" ||
    answer.optionId === "allow"
  ) {
    return true;
  }
  if (
    answer.optionId === "deny" ||
    answer.optionId === "reject_once" ||
    answer.optionId === "reject_always"
  ) {
    return false;
  }
  if (answer.action === "accept") {
    return true;
  }
  if (answer.action === "decline" || answer.action === "cancel") {
    return false;
  }
  return null;
}

function userInputAnswer(
  request: ZCodeUserInputRequestParams,
  answer: {
    optionId?: string;
    freeText?: string;
    action?: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
  },
): ZCodeUserInputResponse {
  if (answer.action === "decline" || answer.action === "cancel") {
    return { action: answer.action };
  }
  if (answer.action === "accept") {
    return {
      action: "accept",
      ...(answer.content ? { content: answer.content } : {}),
    };
  }
  if (answer.freeText !== undefined) {
    return { action: "accept", content: { answer: answer.freeText } };
  }
  if (answer.optionId !== undefined) {
    const option = request.questions
      ?.flatMap((question) => question.options ?? [])
      .find((candidate) => candidate.value === answer.optionId);
    return {
      action: "accept",
      content: { answer: option?.value ?? answer.optionId },
    };
  }
  return { action: "decline" };
}

class ZcodeAgentAdapter {
  private readonly connectionId = `webui-zcode-${process.pid}-${randomUUID()}`;
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly routes = new Map<string, { topic: string }>();
  private readonly pendingInteractions = new Map<string, PendingInteraction>();
  private disposed = false;

  constructor(private readonly engines: ZcodeEngineRegistry) {}

  async initialize(
    params: ZCodeAgentWorkspaceTarget,
  ): Promise<ZCodeAgentInitializeResult> {
    const workspaceKey = params.workspaceIdentity || params.workspacePath;
    try {
      const result = (await this.engines.dispatch(
        zcodeProtocolMethods.runtimeCapabilities,
        { workspacePath: params.workspacePath },
      )) as { version?: unknown };
      return {
        available: true,
        workspaceKey,
        protocolName: "tnt-app-server",
        ...(typeof result?.version === "number"
          ? { protocolVersion: result.version }
          : {}),
      };
    } catch (error) {
      return {
        available: false,
        workspaceKey,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createSession(
    params: ZCodeAgentCreateSessionParams,
  ): Promise<ZCodeSessionStateSnapshot> {
    await this.ensureWorkspace(params.workspacePath);
    return (await this.engines.dispatch(
      zcodeProtocolMethods.sessionCreate,
      createSessionParams(params),
    )) as ZCodeSessionStateSnapshot;
  }

  async resumeSession(
    params: ZCodeAgentResumeSessionParams,
  ): Promise<ZCodeSessionStateSnapshot> {
    await this.ensureWorkspace(params.workspacePath);
    return (await this.engines.dispatch(
      zcodeProtocolMethods.sessionResume,
      resumeSessionParams(params),
    )) as ZCodeSessionStateSnapshot;
  }

  async listSessions(
    params: AgentListSessionsParams,
  ): Promise<ZCodeSessionInfo[]> {
    await this.ensureWorkspace(params.workspacePath);
    const result = (await this.engines.dispatch(
      zcodeProtocolMethods.sessionList,
      listSessionsParams(params),
    )) as { sessions?: ZCodeSessionInfo[] };
    return result.sessions ?? [];
  }

  async readSession(
    params: ZCodeAgentReadSessionParams,
  ): Promise<ZCodeSessionStateSnapshot> {
    return (await this.engines.dispatch(
      zcodeProtocolMethods.sessionRead,
      readSessionParams(params),
    )) as ZCodeSessionStateSnapshot;
  }

  async readSessionMessages(
    params: AgentReadMessagesParams,
  ): Promise<ZCodeMessageWithParts[]> {
    const result = (await this.engines.dispatch(
      zcodeProtocolMethods.sessionMessages,
      readMessagesParams(params),
    )) as { messages?: ZCodeMessageWithParts[] };
    return result.messages ?? [];
  }

  async sendPrompt(
    params: ZCodeAgentSendPromptParams,
  ): Promise<ZCodeSessionSendResult> {
    return (await this.engines.dispatch(
      zcodeProtocolMethods.sessionSend,
      sendPromptParams(params),
    )) as ZCodeSessionSendResult;
  }

  async closeSession(
    params: ZCodeAgentSessionTarget & {
      expectedPersistence?: "deferred" | "immediate";
    },
  ): Promise<boolean> {
    const result = (await this.engines.dispatch(
      zcodeProtocolMethods.sessionClose,
      {
        sessionId: params.sessionId,
        ...(params.expectedPersistence
          ? { expectedPersistence: params.expectedPersistence }
          : {}),
      },
    )) as { closed?: boolean };
    return result.closed ?? true;
  }

  async setModel(
    params: ZCodeAgentSetModelParams,
  ): Promise<ZCodeSessionStateSnapshot> {
    return (await this.engines.dispatch(zcodeProtocolMethods.sessionSetModel, {
      sessionId: params.sessionId,
      model: params.model,
      ...(params.expectedRevision === undefined
        ? {}
        : { expectedRevision: params.expectedRevision }),
      ...(params.persistAsWorkspaceLastUsed === undefined
        ? {}
        : {
            persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed,
          }),
    })) as ZCodeSessionStateSnapshot;
  }

  helloConversationV4(): Promise<HelloMessage> {
    return Promise.resolve({
      kind: "hello",
      protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      connectionId: this.connectionId,
      clientMode: CLIENT_MODE,
      deliveryProfile: "continuous",
      serverTime: Date.now(),
      capabilities: {
        nativeDialogs: false,
        localTerminal: true,
        binaryFrames: false,
        compression: "none",
        workspaceHookReview: false,
        independentPlanState: false,
        genUiContext: false,
        workflowRunDeltas: false,
        historyFirst: false,
        inputPrediction: false,
        residentRowsRange: false,
      },
      auth: {},
    });
  }

  async initializeConversationV4(clientHello: ClientHello): Promise<void> {
    clientHelloSchema.parse(clientHello);
  }

  async subscribeConversationV4(
    params: AgentConversationSubscribeParams,
  ): Promise<V4ConversationSubscribeResult> {
    await this.ensureWorkspace(params.workspacePath);
    const result = (await this.engines.dispatch(
      V4_METHODS.conversationSubscribe,
      {
        topic: conversationTopic(params.sessionId),
        connectionId: this.connectionId,
        clientMode: CLIENT_MODE,
        workspace: workspaceRef(params),
        ...(params.base ? { base: params.base } : {}),
        ...(params.visibility ? { visibility: params.visibility } : {}),
        ...(params.retryInitialization
          ? { retryInitialization: params.retryInitialization }
          : {}),
      },
    )) as V4ConversationSubscribeResult;
    this.routes.set(result.ack.subscriptionId, {
      topic: conversationTopic(params.sessionId),
    });
    return result;
  }

  async resyncConversationV4(
    params: AgentConversationResyncParams,
  ): Promise<V4ConversationResyncResult> {
    const route = this.routes.get(params.subscriptionId);
    if (!route) {
      throw new Error(`Unknown subscription: ${params.subscriptionId}`);
    }
    await this.ensureWorkspace(params.workspacePath);
    return (await this.engines.dispatch(V4_METHODS.conversationResync, {
      topic: route.topic,
      connectionId: this.connectionId,
      subscriptionId: params.subscriptionId,
      base: params.base,
      ...(params.forceSnapshot === undefined
        ? {}
        : { forceSnapshot: params.forceSnapshot }),
    })) as V4ConversationResyncResult;
  }

  async unsubscribeConversationV4(
    params: AgentConversationUnsubscribeParams,
  ): Promise<void> {
    const route = this.routes.get(params.subscriptionId);
    this.routes.delete(params.subscriptionId);
    if (!route) {
      return;
    }
    await this.engines.dispatch(V4_METHODS.conversationUnsubscribe, {
      topic: route.topic,
      connectionId: this.connectionId,
      subscriptionId: params.subscriptionId,
    });
  }

  async sendConversationCommandV4(
    params: AgentConversationCommandParams,
  ): Promise<CommandAck> {
    await this.ensureWorkspace(params.workspacePath);
    const ack = (await this.engines.dispatch(V4_METHODS.command, {
      ...params.envelope,
      workspacePath: params.workspacePath,
    })) as CommandAck;
    if (params.envelope.type === "resolveInteraction") {
      this.answerPendingInteraction(params.envelope, ack);
    }
    return ack;
  }

  getSessionLifecycle(): Promise<null> {
    // The app-server exposes no lifecycle facts; an empty answer keeps the v4
    // pane from treating the missing method as a connection failure.
    return Promise.resolve(null);
  }

  onDynamicSessionEvent(
    params: ZCodeAgentSessionSubscribeParams,
  ): Event<ZCodeAgentServiceEvent> {
    const state = this.stateFor(params.workspacePath);
    return (listener) => {
      let ready = false;
      let lastSeq = params.afterSeq ?? 0;
      const buffered: ZCodeAgentServiceEvent[] = [];
      const deliver = (event: ZCodeAgentServiceEvent): void => {
        if (event.type === "session.event") {
          if (event.event.sessionId !== params.sessionId) {
            return;
          }
          if (event.event.seq <= lastSeq) {
            return;
          }
          lastSeq = event.event.seq;
        } else {
          const sessionId = commandSessionId(event);
          if (sessionId !== null && sessionId !== params.sessionId) {
            return;
          }
        }
        listener(event);
      };
      const subscription = state.sessionEvents.event((event) => {
        if (ready) {
          deliver(event);
        } else {
          buffered.push(event);
        }
      });
      void this.ensureWorkspace(params.workspacePath)
        .then(() => this.subscribeSession(params))
        .then((result) => {
          for (const event of result.events) {
            deliver({ type: "session.event", event });
          }
          lastSeq = Math.max(lastSeq, result.eventSeq);
          if (result.snapshot) {
            deliver({ type: "snapshot", snapshot: result.snapshot });
          }
        })
        .catch((error: unknown) => {
          logger.debug("webui-zcode: session replay failed", {
            sessionId: params.sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          ready = true;
          for (const event of buffered.splice(0)) {
            deliver(event);
          }
        });
      return subscription;
    };
  }

  onDynamicConversationFrame(
    params: ZCodeAgentWorkspaceTarget,
  ): Event<ConversationTopicWireCandidate> {
    const state = this.stateFor(params.workspacePath);
    void this.ensureWorkspace(params.workspacePath).catch((error: unknown) => {
      logger.debug("webui-zcode: frame subscription failed", {
        workspacePath: params.workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return state.frames.event;
  }

  disposeWorkspace(params: ZCodeAgentWorkspaceTarget): Promise<void> {
    this.teardownWorkspace(path.resolve(params.workspacePath));
    return Promise.resolve();
  }

  disposeAll(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const key of [...this.workspaces.keys()]) {
      this.teardownWorkspace(key);
    }
    this.routes.clear();
    for (const pending of this.pendingInteractions.values()) {
      pending.resolve({});
    }
    this.pendingInteractions.clear();
  }

  private stateFor(workspacePath: string): WorkspaceState {
    const key = path.resolve(workspacePath);
    const existing = this.workspaces.get(key);
    if (existing) {
      return existing;
    }
    const state: WorkspaceState = {
      sessionEvents: new Emitter<ZCodeAgentServiceEvent>(),
      frames: new Emitter<ConversationTopicWireCandidate>(),
      unsubscribe: null,
      installing: null,
    };
    this.workspaces.set(key, state);
    return state;
  }

  private async ensureWorkspace(workspacePath: string): Promise<void> {
    if (this.disposed) {
      throw new Error("ZCODE_UNAVAILABLE: agent service is disposed");
    }
    const key = path.resolve(workspacePath);
    const state = this.stateFor(key);
    state.installing ??= (async () => {
      state.unsubscribe = await this.engines.subscribe(key, (notification) =>
        this.onNotification(key, notification),
      );
      await this.engines.setRequestHandler(key, (method, params) =>
        this.onEngineRequest(key, method, params),
      );
    })().catch((error: unknown) => {
      state.installing = null;
      throw error;
    });
    await state.installing;
  }

  private onNotification(
    workspacePath: string,
    notification: EngineNotification,
  ): void {
    const state = this.workspaces.get(workspacePath);
    if (!state) {
      return;
    }
    if (notification.method === SESSION_EVENT_NOTIFICATION) {
      state.sessionEvents.fire({
        type: "session.event",
        event: notification.params as ZCodeSessionEvent,
      });
      return;
    }
    if (notification.method === V4_NOTIFICATIONS.conversationFrame) {
      state.frames.fire(notification.params as ConversationTopicWireCandidate);
    }
  }

  private async onEngineRequest(
    workspacePath: string,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    if (method === zcodeProtocolMethods.interactionRequestPermission) {
      const parsed = zcodePermissionRequestParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new Error("Invalid permission request params");
      }
      return this.awaitInteraction(workspacePath, parsed.data.requestId, {
        type: "permission.request",
        request: parsed.data,
      });
    }
    if (method === zcodeProtocolMethods.interactionRequestUserInput) {
      const parsed = zcodeUserInputRequestParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new Error("Invalid user input request params");
      }
      return this.awaitInteraction(workspacePath, parsed.data.requestId, {
        type: "userInput.request",
        request: parsed.data,
      });
    }
    throw new Error(`Unsupported engine request: ${method}`);
  }

  private awaitInteraction(
    workspacePath: string,
    requestId: string,
    event:
      | { type: "permission.request"; request: ZCodePermissionRequestParams }
      | { type: "userInput.request"; request: ZCodeUserInputRequestParams },
  ): Promise<unknown> {
    this.workspaces.get(workspacePath)?.sessionEvents.fire(event);
    const result = new Promise<unknown>((resolve) => {
      this.pendingInteractions.set(requestId, {
        workspacePath,
        event,
        resolve,
      });
    });
    // The engine awaits this result; keep a handled branch so a disposed
    // adapter cannot surface an unhandled rejection.
    void result.catch(() => undefined);
    return result;
  }

  private answerPendingInteraction(
    envelope: CommandEnvelope,
    ack: CommandAck,
  ): void {
    const parsed = commandPayloadSchemas.resolveInteraction.safeParse(
      envelope.payload,
    );
    if (!parsed.success) {
      return;
    }
    const { interactionId, answer } = parsed.data;
    const pending = this.pendingInteractions.get(interactionId);
    if (!pending) {
      return;
    }
    this.pendingInteractions.delete(interactionId);
    if (ack.status === "rejected" || ack.status === "failed") {
      pending.resolve({});
      return;
    }
    if (pending.event.type === "permission.request") {
      const allowed = isPermissionAllowed(answer);
      pending.resolve(
        allowed === null ? {} : { decision: allowed ? "allow" : "deny" },
      );
      return;
    }
    const response = userInputAnswer(pending.event.request, answer);
    pending.resolve(response);
    this.workspaces.get(pending.workspacePath)?.sessionEvents.fire({
      type: "userInput.response",
      requestId: interactionId,
      response,
    });
  }

  private teardownWorkspace(workspacePath: string): void {
    const state = this.workspaces.get(workspacePath);
    this.workspaces.delete(workspacePath);
    state?.unsubscribe?.();
    state?.sessionEvents.dispose();
    state?.frames.dispose();
    for (const [requestId, pending] of this.pendingInteractions) {
      if (pending.workspacePath !== workspacePath) {
        continue;
      }
      this.pendingInteractions.delete(requestId);
      pending.resolve({});
    }
  }

  private async subscribeSession(
    params: ZCodeAgentSessionSubscribeParams,
  ): Promise<EngineSessionSubscribeResult> {
    const result = (await this.engines.dispatch(
      zcodeProtocolMethods.sessionSubscribe,
      {
        sessionId: params.sessionId,
        deliveryKind: params.deliveryKind,
        ...(params.afterSeq === undefined ? {} : { afterSeq: params.afterSeq }),
        ...(params.includeSnapshot === undefined
          ? {}
          : { includeSnapshot: params.includeSnapshot }),
      },
    )) as EngineSessionSubscribeResult;
    return result;
  }
}

export interface ZcodeAgentServiceHandle {
  readonly service: IZCodeAgentService;
  dispose(): void;
}

/**
 * One connection's adapter from `IZCodeAgentService` to the app-server engines.
 * Methods the app-server does not implement are left to the stub fallback, so
 * they reject with the stable `ZCODE_UNAVAILABLE` code instead of pretending
 * to have run.
 */
export function createZcodeAgentService(
  engines: ZcodeEngineRegistry,
): ZcodeAgentServiceHandle {
  const adapter = new ZcodeAgentAdapter(engines);
  const overrides: Partial<IZCodeAgentService> = {
    initialize: (params) => adapter.initialize(params),
    createSession: (params) => adapter.createSession(params),
    resumeSession: (params) => adapter.resumeSession(params),
    listSessions: (params) => adapter.listSessions(params),
    readSession: (params) => adapter.readSession(params),
    readSessionMessages: (params) => adapter.readSessionMessages(params),
    sendPrompt: (params) => adapter.sendPrompt(params),
    closeSession: (params) => adapter.closeSession(params),
    setModel: (params) => adapter.setModel(params),
    helloConversationV4: () => adapter.helloConversationV4(),
    initializeConversationV4: (clientHello) =>
      adapter.initializeConversationV4(clientHello),
    subscribeConversationV4: (params) =>
      adapter.subscribeConversationV4(params),
    resyncConversationV4: (params) => adapter.resyncConversationV4(params),
    unsubscribeConversationV4: (params) =>
      adapter.unsubscribeConversationV4(params),
    sendConversationCommandV4: (params) =>
      adapter.sendConversationCommandV4(params),
    getSessionLifecycle: () => adapter.getSessionLifecycle(),
    onDynamicSessionEvent: (params) => adapter.onDynamicSessionEvent(params),
    onDynamicConversationFrame: (params) =>
      adapter.onDynamicConversationFrame(params),
    disposeWorkspace: (params) => adapter.disposeWorkspace(params),
    disposeAll: () => adapter.disposeAll(),
  };
  return {
    service: stubServiceWith<IZCodeAgentService>(
      IZCodeAgentService.channelName,
      overrides,
    ),
    dispose: () => adapter.disposeAll(),
  };
}
