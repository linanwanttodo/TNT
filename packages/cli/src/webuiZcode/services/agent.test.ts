import path from "node:path";

import type { ZCodeAgentServiceEvent } from "@zcode/services";
import {
  zcodeProtocolMethods,
  type ZCodePermissionRequestParams,
  type ZCodeUserInputRequestParams,
} from "@zcode/shared";
import {
  V4_METHODS,
  V4_WIRE_PROTOCOL_VERSION,
  type CommandAck,
  type CommandEnvelope,
  type ConversationTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";
import { describe, expect, it } from "vitest";

import type {
  EngineNotification,
  EngineNotificationListener,
  EngineRequestHandler,
} from "../engineClient.js";

import { createZcodeAgentService, type ZcodeEngineRegistry } from "./agent.js";
import { ZCODE_UNAVAILABLE_PREFIX } from "./stubs.js";

const WORKSPACE = "/tmp/zcode-agent-workspace";
const SESSION = "session-1";

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function snapshot(sessionId = SESSION): unknown {
  return { session: { sessionId } };
}

function permissionRequest(requestId = "perm-1"): ZCodePermissionRequestParams {
  return {
    requestId,
    sessionId: SESSION,
    toolCallId: "call-1",
    toolName: "bash",
    reason: "Tool requires permission",
    riskLevel: "medium",
    input: { command: "ls" },
    options: [
      {
        optionId: "allow_once",
        kind: "allowOnce",
        name: "Allow once",
        response: { decision: "allow" },
      },
      {
        optionId: "deny",
        kind: "deny",
        name: "Deny",
        response: { decision: "deny" },
      },
    ],
  };
}

function userInputRequest(requestId = "input-1"): ZCodeUserInputRequestParams {
  return {
    requestId,
    sessionId: SESSION,
    prompt: "Which model?",
    questions: [
      {
        question: "Which model?",
        header: "Q1",
        options: [
          { value: "a", label: "a" },
          { value: "b", label: "b" },
        ],
      },
    ],
  };
}

function command(
  type: CommandEnvelope["type"],
  payload: unknown,
): CommandEnvelope {
  return {
    commandId: `cmd-${type}`,
    clientId: "test-client",
    sessionId: type === "createSession" ? null : SESSION,
    type,
    payload,
    issuedAt: Date.now(),
  };
}

class FakeRegistry implements ZcodeEngineRegistry {
  readonly calls: { method: string; params: unknown }[] = [];
  readonly unsubscribed: string[] = [];
  readonly handlers = new Map<string, EngineRequestHandler | null>();
  private readonly listeners = new Map<
    string,
    Set<EngineNotificationListener>
  >();
  private readonly responses = new Map<string, (params: unknown) => unknown>();

  respond(method: string, handler: (params: unknown) => unknown): void {
    this.responses.set(method, handler);
  }

  async dispatch(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    const response = this.responses.get(method);
    if (!response) {
      throw new Error(`Unexpected engine request: ${method}`);
    }
    return response(params);
  }

  async subscribe(
    candidate: string,
    listener: EngineNotificationListener,
  ): Promise<() => void> {
    let set = this.listeners.get(candidate);
    if (!set) {
      set = new Set();
      this.listeners.set(candidate, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      this.unsubscribed.push(candidate);
    };
  }

  async setRequestHandler(
    candidate: string,
    handler: EngineRequestHandler | null,
  ): Promise<void> {
    this.handlers.set(candidate, handler);
  }

  emit(candidate: string, notification: EngineNotification): void {
    for (const listener of this.listeners.get(candidate) ?? []) {
      listener(notification);
    }
  }

  requestHandler(candidate: string): EngineRequestHandler {
    const handler = this.handlers.get(candidate);
    if (!handler) {
      throw new Error(`No request handler for ${candidate}`);
    }
    return handler;
  }
}

function buildRegistry(): FakeRegistry {
  const registry = new FakeRegistry();
  registry.respond(zcodeProtocolMethods.runtimeCapabilities, () => ({
    version: 7,
  }));
  registry.respond(zcodeProtocolMethods.sessionCreate, () => snapshot());
  registry.respond(zcodeProtocolMethods.sessionResume, () => snapshot());
  registry.respond(zcodeProtocolMethods.sessionList, () => ({
    sessions: [{ sessionId: SESSION }],
  }));
  registry.respond(zcodeProtocolMethods.sessionRead, () => snapshot());
  registry.respond(zcodeProtocolMethods.sessionMessages, () => ({
    messages: [{ info: { messageId: "m1" }, parts: [] }],
  }));
  registry.respond(zcodeProtocolMethods.sessionSend, (params) => ({
    sessionId: (params as { sessionId: string }).sessionId,
    accepted: true,
    stateRevision: 4,
  }));
  registry.respond(zcodeProtocolMethods.sessionClose, () => ({ closed: true }));
  registry.respond(zcodeProtocolMethods.sessionSetModel, () => snapshot());
  registry.respond(zcodeProtocolMethods.sessionSubscribe, () => ({
    sessionId: SESSION,
    eventSeq: 0,
    events: [],
  }));
  registry.respond(V4_METHODS.conversationSubscribe, () => ({
    ack: {
      subscriptionId: "sub-1",
      mode: "snapshot",
      logEpoch: "epoch-1",
    },
  }));
  registry.respond(V4_METHODS.conversationResync, () => ({
    ack: {
      subscriptionId: "sub-1",
      mode: "snapshot",
      logEpoch: "epoch-1",
    },
  }));
  registry.respond(V4_METHODS.conversationUnsubscribe, () => ({}));
  registry.respond(V4_METHODS.command, (params) => {
    const envelope = params as unknown as CommandEnvelope;
    return {
      commandId: envelope.commandId,
      status: "accepted",
      revisionAtDecision: 2,
    } satisfies CommandAck;
  });
  return registry;
}

function workspaceTarget(workspacePath = WORKSPACE) {
  return { workspacePath };
}

describe("ZCode agent service adapter", () => {
  it("maps session lifecycle and turn methods onto app-server requests", async () => {
    const registry = buildRegistry();
    const { service } = createZcodeAgentService(registry);

    const initialized = await service.initialize(workspaceTarget());
    expect(initialized).toMatchObject({
      available: true,
      workspaceKey: WORKSPACE,
      protocolVersion: 7,
    });

    await service.createSession({
      workspacePath: WORKSPACE,
      workspaceIdentity: "identity-1",
      sessionId: "preassigned",
      sessionTraceId: "trace-1",
      mode: "plan",
      model: { providerId: "test", modelId: "fake" },
      thoughtLevel: "high",
      mcpServers: [{ name: "mcp", command: "node", args: [], env: [] }],
    });
    const create = registry.calls.find(
      (call) => call.method === zcodeProtocolMethods.sessionCreate,
    );
    expect(create?.params).toMatchObject({
      workspace: {
        workspacePath: WORKSPACE,
        workspaceIdentity: "identity-1",
        workspaceKey: "identity-1",
      },
      sessionId: "preassigned",
      mode: "plan",
      model: { providerId: "test", modelId: "fake" },
      thoughtLevel: "high",
    });
    expect(create?.params).not.toHaveProperty("sessionTraceId");

    await service.resumeSession({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      model: { providerId: "test", modelId: "fake" },
      thoughtLevel: "low",
    });
    const resume = registry.calls.find(
      (call) => call.method === zcodeProtocolMethods.sessionResume,
    );
    expect(resume?.params).toMatchObject({
      sessionId: SESSION,
      workspace: { workspacePath: WORKSPACE, workspaceKey: WORKSPACE },
      thoughtLevel: "low",
    });
    // The app-server resume schema has no model field; it must not leak.
    expect(resume?.params).not.toHaveProperty("model");

    const listed = await service.listSessions(workspaceTarget());
    expect(listed).toHaveLength(1);

    await service.readSession({ workspacePath: WORKSPACE, sessionId: SESSION });
    await service.readSessionMessages({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      limit: 10,
    });
    const messages = registry.calls.find(
      (call) => call.method === zcodeProtocolMethods.sessionMessages,
    );
    expect(messages?.params).toEqual({ sessionId: SESSION, limit: 10 });

    const sent = await service.sendPrompt({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      content: "hello",
      messageId: "message-only",
      sessionTraceId: "trace-only",
    });
    expect(sent).toEqual({
      sessionId: SESSION,
      accepted: true,
      stateRevision: 4,
    });
    const send = registry.calls.find(
      (call) => call.method === zcodeProtocolMethods.sessionSend,
    );
    expect(send?.params).toEqual({ sessionId: SESSION, content: "hello" });

    await expect(
      service.closeSession({ workspacePath: WORKSPACE, sessionId: SESSION }),
    ).resolves.toBe(true);
    await service.setModel({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      model: { providerId: "test", modelId: "fake" },
    });
  });

  it("forwards the host thoughtLevel with the model selection on send", async () => {
    const registry = buildRegistry();
    const { service } = createZcodeAgentService(registry);

    await service.sendPrompt({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      content: "hello",
      modelSelection: {
        providerId: "test",
        modelId: "fake",
        options: { reasoningLevel: "high" },
      },
      thoughtLevel: "low",
    } as never);

    const send = registry.calls.find(
      (call) => call.method === zcodeProtocolMethods.sessionSend,
    );
    expect(send?.params).toEqual({
      sessionId: SESSION,
      content: "hello",
      modelSelection: {
        providerId: "test",
        modelId: "fake",
        options: { reasoningLevel: "high" },
      },
      thoughtLevel: "low",
    });
  });

  it("bridges session events and conversation frames per workspace", async () => {
    const registry = buildRegistry();
    const { service } = createZcodeAgentService(registry);
    const events: ZCodeAgentServiceEvent[] = [];
    const otherEvents: ZCodeAgentServiceEvent[] = [];
    const frames: ConversationTopicWireCandidate[] = [];
    const otherWorkspace = "/tmp/zcode-agent-other-workspace";

    const stopEvents = service.onDynamicSessionEvent({
      ...workspaceTarget(),
      sessionId: SESSION,
      deliveryKind: "desktop-continuous",
    })((event) => events.push(event));
    const stopOtherEvents = service.onDynamicSessionEvent({
      ...workspaceTarget(otherWorkspace),
      sessionId: SESSION,
      deliveryKind: "desktop-continuous",
    })((event) => otherEvents.push(event));
    const stopFrames = service.onDynamicConversationFrame(workspaceTarget())(
      (frame) => frames.push(frame),
    );
    await flush();
    await flush();

    registry.emit(path.resolve(WORKSPACE), {
      method: "session/event",
      params: {
        sessionId: SESSION,
        turnId: "turn-1",
        seq: 1,
        timestamp: 1,
        type: "turn.started",
      },
    });
    registry.emit(path.resolve(otherWorkspace), {
      method: "session/event",
      params: {
        sessionId: SESSION,
        turnId: "turn-other",
        seq: 1,
        timestamp: 1,
        type: "turn.started",
      },
    });
    registry.emit(path.resolve(WORKSPACE), {
      method: "session/event",
      params: {
        sessionId: "other",
        turnId: "turn-2",
        seq: 1,
        timestamp: 1,
        type: "turn.started",
      },
    });
    const frame = {
      wireVersion: 1,
      kind: "complete",
      topic: `conversation/${SESSION}`,
      subscriptionId: "sub-1",
      frame: { topic: `conversation/${SESSION}` },
    } as unknown as ConversationTopicWireCandidate;
    registry.emit(path.resolve(WORKSPACE), {
      method: "v4/conversation/frame",
      params: frame,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session.event",
      event: { sessionId: SESSION },
    });
    expect(otherEvents).toHaveLength(1);
    expect(otherEvents[0]).toMatchObject({
      type: "session.event",
      event: { sessionId: SESSION, turnId: "turn-other" },
    });
    expect(frames).toEqual([frame]);

    stopEvents.dispose();
    stopOtherEvents.dispose();
    stopFrames.dispose();
  });

  it("round-trips permission and question interactions through the command surface", async () => {
    const registry = buildRegistry();
    const { service } = createZcodeAgentService(registry);
    const events: ZCodeAgentServiceEvent[] = [];
    const stop = service.onDynamicSessionEvent({
      ...workspaceTarget(),
      sessionId: SESSION,
      deliveryKind: "desktop-continuous",
    })((event) => events.push(event));
    await flush();
    await flush();

    const handler = registry.requestHandler(path.resolve(WORKSPACE));
    const permission = handler(
      zcodeProtocolMethods.interactionRequestPermission,
      permissionRequest(),
    );
    await flush();
    expect(events).toContainEqual({
      type: "permission.request",
      request: permissionRequest(),
    });

    await service.sendConversationCommandV4({
      ...workspaceTarget(),
      envelope: command("resolveInteraction", {
        interactionId: "perm-1",
        answer: { optionId: "allow_once" },
      }),
    });
    await expect(permission).resolves.toEqual({ decision: "allow" });

    const question = handler(
      zcodeProtocolMethods.interactionRequestUserInput,
      userInputRequest(),
    );
    await flush();
    expect(events).toContainEqual({
      type: "userInput.request",
      request: userInputRequest(),
    });
    await service.sendConversationCommandV4({
      ...workspaceTarget(),
      envelope: command("resolveInteraction", {
        interactionId: "input-1",
        answer: { optionId: "b" },
      }),
    });
    await expect(question).resolves.toEqual({
      action: "accept",
      content: { answer: "b" },
    });
    expect(events).toContainEqual({
      type: "userInput.response",
      requestId: "input-1",
      response: { action: "accept", content: { answer: "b" } },
    });

    stop.dispose();
  });

  it("declares workflowRunDeltas and honors the clientHello capability", async () => {
    const registry = buildRegistry();
    const handle = createZcodeAgentService(registry);
    const { service } = handle;

    const hello = await service.helloConversationV4();
    expect(hello.capabilities.workflowRunDeltas).toBe(true);

    // A legacy client that declares nothing stays on the clamped whole-key path.
    await service.subscribeConversationV4({
      ...workspaceTarget(),
      sessionId: SESSION,
    });
    const legacySubscribe = registry.calls
      .filter((call) => call.method === V4_METHODS.conversationSubscribe)
      .at(-1);
    expect(legacySubscribe?.params).not.toHaveProperty("workflowRunDeltas");

    await service.initializeConversationV4({
      kind: "clientHello",
      protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      clientId: "desktop-test",
      appVersion: "1.0.0",
      capabilities: { workflowRunDeltas: true },
    });
    await service.subscribeConversationV4({
      ...workspaceTarget(),
      sessionId: SESSION,
    });
    const capableSubscribe = registry.calls
      .filter((call) => call.method === V4_METHODS.conversationSubscribe)
      .at(-1);
    expect(capableSubscribe?.params).toMatchObject({
      workflowRunDeltas: true,
    });
  });

  it("routes conversation subscriptions and answers unavailable methods", async () => {
    const registry = buildRegistry();
    const handle = createZcodeAgentService(registry);
    const { service } = handle;

    const subscribed = await service.subscribeConversationV4({
      ...workspaceTarget(),
      sessionId: SESSION,
    });
    expect(subscribed.ack.subscriptionId).toBe("sub-1");
    const subscribe = registry.calls.find(
      (call) => call.method === V4_METHODS.conversationSubscribe,
    );
    expect(subscribe?.params).toMatchObject({
      topic: `conversation/${SESSION}`,
      workspace: { workspacePath: WORKSPACE, workspaceKey: WORKSPACE },
      clientMode: "desktop-continuous",
    });

    await service.resyncConversationV4({
      ...workspaceTarget(),
      subscriptionId: "sub-1",
      base: null,
    });
    const resync = registry.calls.find(
      (call) => call.method === V4_METHODS.conversationResync,
    );
    expect(resync?.params).toMatchObject({
      topic: `conversation/${SESSION}`,
      subscriptionId: "sub-1",
    });

    await service.unsubscribeConversationV4({
      ...workspaceTarget(),
      subscriptionId: "sub-1",
    });
    expect(
      registry.calls.some(
        (call) => call.method === V4_METHODS.conversationUnsubscribe,
      ),
    ).toBe(true);

    await expect(
      service.setThoughtLevel({
        workspacePath: WORKSPACE,
        sessionId: SESSION,
        thoughtLevel: "high",
      }),
    ).rejects.toThrow(ZCODE_UNAVAILABLE_PREFIX);
    await expect(
      service.readWorkspacePresentation(workspaceTarget()),
    ).rejects.toThrow(ZCODE_UNAVAILABLE_PREFIX);

    handle.dispose();
    expect(registry.unsubscribed).toContain(path.resolve(WORKSPACE));
    expect(handle.service.disposeAll()).toBeUndefined();
  });

  it("settles pending interactions on dispose without unhandled rejections", async () => {
    const registry = buildRegistry();
    const handle = createZcodeAgentService(registry);
    const events: ZCodeAgentServiceEvent[] = [];
    const stop = handle.service.onDynamicSessionEvent({
      ...workspaceTarget(),
      sessionId: SESSION,
      deliveryKind: "desktop-continuous",
    })((event) => events.push(event));
    await flush();
    await flush();

    const pending = registry.requestHandler(path.resolve(WORKSPACE))(
      zcodeProtocolMethods.interactionRequestPermission,
      permissionRequest("perm-dispose"),
    );
    await flush();
    expect(events.some((event) => event.type === "permission.request")).toBe(
      true,
    );

    expect(() => handle.dispose()).not.toThrow();
    await expect(pending).resolves.toEqual({});
    stop.dispose();
  });
});
