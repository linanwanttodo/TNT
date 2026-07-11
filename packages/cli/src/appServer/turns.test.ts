import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { zcodeSessionEventSchema } from "@zcode/shared";
import type { ZCodeSessionEvent } from "@zcode/shared";
import {
  conversationTopicWireFrameSchema,
  V4_NOTIFICATIONS,
} from "@zcode/shared/zcode-protocol-v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishAgentEvent } from "../protocol/eventBus.js";
import type { RunTurn } from "../services/TurnRunnerService.js";
import { sessionStore } from "../session/store.js";
import { messageQueue } from "../stream/messageQueue.js";

import { AppServerProtocol } from "./protocol.js";
import { SessionRegistry } from "./sessionRegistry.js";
import type { PendingTurn, TurnExecutor, TurnPump } from "./turns.js";

interface RecordedMessage {
  id?: unknown;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message?: string };
}

class RecordingSender {
  readonly messages: RecordedMessage[] = [];

  async send(message: unknown): Promise<void> {
    this.messages.push(message as RecordedMessage);
  }

  responses(id: unknown): RecordedMessage[] {
    return this.messages.filter((message) => message.id === id);
  }

  notifications(method: string): RecordedMessage[] {
    return this.messages.filter((message) => message.method === method);
  }
}

class FakePump implements TurnPump {
  private running = false;
  private controller: AbortController | null = null;
  private active: Promise<void> | null = null;

  startDraining(runTurn?: RunTurn): void {
    if (this.running) {
      return;
    }
    if (!runTurn) {
      return;
    }
    this.running = true;
    this.active = this.drain(runTurn);
  }

  isRunning(): boolean {
    return this.running;
  }

  requestStop(): void {
    this.controller?.abort();
  }

  async whenIdle(): Promise<void> {
    await this.active;
    this.active = null;
  }

  private async drain(runTurn: RunTurn): Promise<void> {
    try {
      let message = messageQueue.getNextMessage();
      while (message) {
        const controller = new AbortController();
        this.controller = controller;
        try {
          await runTurn(message, controller.signal);
        } finally {
          this.controller = null;
        }
        message = messageQueue.getNextMessage();
      }
    } finally {
      this.running = false;
    }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function publishTurn(sessionId: string, turnId: string): void {
  const base = { sessionId, turnId };
  publishAgentEvent({
    ...base,
    seq: 1,
    timestamp: 1_000,
    type: "turn.started",
    model: "test-model",
    historyLength: 0,
  });
  publishAgentEvent({
    ...base,
    seq: 2,
    timestamp: 1_010,
    type: "content.delta",
    delta: "Hello",
  });
  publishAgentEvent({
    ...base,
    seq: 3,
    timestamp: 1_020,
    type: "tool.started",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "ls" },
  });
  publishAgentEvent({
    ...base,
    seq: 4,
    timestamp: 1_030,
    type: "tool.finished",
    toolCallId: "call-1",
    toolName: "bash",
    status: "done",
    result: "ok",
  });
  publishAgentEvent({
    ...base,
    seq: 5,
    timestamp: 1_040,
    type: "turn.completed",
    content: "Hello",
  });
}

function commandEnvelope(
  sessionId: string,
  type: string,
  payload: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    commandId: `cmd-${type}`,
    clientId: "client-1",
    sessionId,
    type,
    payload,
    issuedAt: Date.now(),
    ...extra,
  };
}

describe("app-server turns and v4 conversation frames", () => {
  let root: string;
  let workspace: string;
  let previousGlobalDir: string | undefined;
  let sender: RecordingSender;
  let pump: FakePump;
  let protocol: AppServerProtocol;
  let executor: TurnExecutor;

  beforeEach(() => {
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-app-server-turns-"));
    process.env.TNT_GLOBAL_DIR = root;
    sessionStore.clearAll();
    messageQueue.clearMessages();
    workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    sender = new RecordingSender();
    pump = new FakePump();
    executor = async (turn) => {
      publishTurn(turn.sessionId, `turn-${Date.now()}`);
    };
    protocol = new AppServerProtocol(sender, new SessionRegistry(root), {
      modelLookup: {
        getAvailableChatModels: () => [
          { provider: "test", name: "fake", index: 0 },
        ],
      },
      runTurn: executor,
      pump,
      ensureServices: async () => undefined,
    });
  });

  afterEach(() => {
    protocol.dispose();
    messageQueue.clearMessages();
    sessionStore.releaseAll();
    fs.rmSync(root, { recursive: true, force: true });
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
  });

  async function createSession(): Promise<string> {
    await protocol.handle({
      id: "create",
      method: "session/create",
      params: {
        workspace: { workspacePath: workspace, workspaceKey: workspace },
        model: { providerId: "test", modelId: "fake" },
      },
    });
    const response = sender.responses("create")[0];
    return (response?.result as { session: { sessionId: string } }).session
      .sessionId;
  }

  it("streams an ordered session/event turn through session/send", async () => {
    const sessionId = await createSession();
    await protocol.handle({
      id: "sub",
      method: "session/subscribe",
      params: {
        sessionId,
        deliveryKind: "desktop-continuous",
        includeSnapshot: true,
      },
    });
    const subscribed = sender.responses("sub")[0]?.result as {
      snapshot: { runtime: { eventSeq: number } };
    };
    expect(subscribed.snapshot.runtime.eventSeq).toBe(0);

    await protocol.handle({
      id: "send",
      method: "session/send",
      params: { sessionId, content: "hi" },
    });
    await pump.whenIdle();

    const sendResult = sender.responses("send")[0]?.result as {
      accepted: boolean;
      stateRevision: number;
    };
    expect(sendResult).toMatchObject({ accepted: true });
    expect(sendResult.stateRevision).toBeGreaterThanOrEqual(1);

    const events = sender
      .notifications("session/event")
      .map((message) => zcodeSessionEventSchema.parse(message.params));
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "part.delta",
      "tool.updated",
      "tool.updated",
      "part.upserted",
      "turn.completed",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const event of events) {
      expect(event.sessionId).toBe(sessionId);
    }
  });

  it("carries a send's model and reasoning selection into the turn", async () => {
    const captured: PendingTurn[] = [];
    const live = new AppServerProtocol(sender, new SessionRegistry(root), {
      modelLookup: {
        getAvailableChatModels: () => [
          { provider: "test", name: "fake", index: 0 },
        ],
      },
      runTurn: async (turn) => {
        captured.push(turn);
      },
      pump,
      ensureServices: async () => undefined,
    });
    protocol.dispose();
    protocol = live;
    const sessionId = await createSession();

    await protocol.handle({
      id: "send",
      method: "session/send",
      params: {
        sessionId,
        content: "hi",
        thoughtLevel: "low",
        modelSelection: {
          providerId: "test",
          modelId: "fake",
          options: { reasoningLevel: "high" },
        },
      },
    });
    await pump.whenIdle();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      sessionId,
      text: "hi",
      thoughtLevel: "low",
      modelSelection: {
        providerId: "test",
        modelId: "fake",
        options: { reasoningLevel: "high" },
      },
    });
  });

  it("aborts the active turn and ends it with an interrupted turn.completed", async () => {
    const sessionId = await createSession();
    const started = deferred();
    executor = async (turn, signal) => {
      publishAgentEvent({
        sessionId: turn.sessionId,
        turnId: "turn-interrupt",
        seq: 1,
        timestamp: 2_000,
        type: "turn.started",
        model: "test-model",
        historyLength: 0,
      });
      publishAgentEvent({
        sessionId: turn.sessionId,
        turnId: "turn-interrupt",
        seq: 2,
        timestamp: 2_010,
        type: "content.delta",
        delta: "partial",
      });
      started.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            publishAgentEvent({
              sessionId: turn.sessionId,
              turnId: "turn-interrupt",
              seq: 3,
              timestamp: 2_020,
              type: "turn.interrupted",
              reason: "user_abort",
            });
            resolve();
          },
          { once: true },
        );
      });
    };
    const live = new AppServerProtocol(sender, new SessionRegistry(root), {
      runTurn: executor,
      pump,
      ensureServices: async () => undefined,
    });
    protocol.dispose();
    protocol = live;

    await protocol.handle({
      id: "sub",
      method: "session/subscribe",
      params: { sessionId, deliveryKind: "desktop-continuous" },
    });
    await protocol.handle({
      id: "send",
      method: "session/send",
      params: { sessionId, content: "hi" },
    });
    await started.promise;
    await protocol.handle({
      id: "stop",
      method: "session/stop",
      params: { sessionId },
    });
    await pump.whenIdle();

    const events = sender
      .notifications("session/event")
      .map((message) => zcodeSessionEventSchema.parse(message.params));
    expectsTerminal(events);
  });

  it("answers v4 subscribe with an ack plus a snapshot wire frame and streams rows", async () => {
    const sessionId = await createSession();
    await protocol.handle({
      id: "v4sub",
      method: "v4/conversation/subscribe",
      params: {
        topic: `conversation/${sessionId}`,
        connectionId: "conn-1",
        clientMode: "desktop-continuous",
      },
    });
    const ack = sender.responses("v4sub")[0]?.result as {
      ack: { subscriptionId: string; mode: string; logEpoch: string };
    };
    expect(ack.ack.mode).toBe("snapshot");

    await protocol.handle({
      id: "v4send",
      method: "v4/command",
      params: commandEnvelope(sessionId, "sendText", { text: "hi" }),
    });
    await pump.whenIdle();

    const ackResult = sender.responses("v4send")[0]?.result as {
      status: string;
      result: { type: string; delivery: string };
    };
    expect(ackResult.status).toBe("accepted");
    expect(ackResult.result.type).toBe("inputAccepted");

    const frames = sender
      .notifications(V4_NOTIFICATIONS.conversationFrame)
      .map((message) => conversationTopicWireFrameSchema.parse(message.params))
      .filter((wire) => wire.kind === "complete");
    expect(frames).toHaveLength(7);
    expect(frames[0].frame.payload.kind).toBe("snapshot");
    const liveOps = frames
      .slice(1)
      .flatMap((wire) =>
        wire.frame.payload.kind === "deltas" ? wire.frame.payload.deltas : [],
      )
      .map((delta) => delta.op);
    expect(liveOps).toContain("row.appended");
    expect(liveOps).toContain("row.delta");
    expect(liveOps).toContain("row.upserted");
    for (const wire of frames) {
      expect(wire.topic).toBe(`conversation/${sessionId}`);
      expect(wire.subscriptionId).toBe(ack.ack.subscriptionId);
    }
  });

  it("renames a session with a session/event titleUpdated envelope", async () => {
    const sessionId = await createSession();
    await protocol.handle({
      id: "sub",
      method: "session/subscribe",
      params: { sessionId, deliveryKind: "desktop-continuous" },
    });
    await protocol.handle({
      id: "rename",
      method: "v4/command",
      params: commandEnvelope(sessionId, "renameSession", {
        title: "Renamed by test",
      }),
    });

    const renamed = sender
      .notifications("session/event")
      .map((message) => zcodeSessionEventSchema.parse(message.params))
      .filter((event) => event.type === "session.titleUpdated");
    expect(renamed).toHaveLength(1);
    expect(renamed[0].payload).toMatchObject({
      previousTitle: "Untitled Session",
      title: "Renamed by test",
      source: "custom",
    });
    expect(sender.responses("rename")[0]?.result).toMatchObject({
      status: "accepted",
    });
  });

  it("answers an unsupported v4 command with a method error and keeps serving", async () => {
    const sessionId = await createSession();
    await protocol.handle({
      id: "unsupported",
      method: "v4/command",
      params: commandEnvelope(
        sessionId,
        "forkAssistant",
        { target: { rowId: 1, entityId: "assistant" } },
        { baseRevision: 0, baseLogEpoch: "epoch-1" },
      ),
    });

    expect(sender.responses("unsupported")[0]?.error).toMatchObject({
      code: -32601,
      message: "Unsupported command: forkAssistant",
    });

    await protocol.handle({
      id: "alive",
      method: "runtime/capabilities",
      params: {},
    });
    expect(sender.responses("alive")[0]?.result).toBeDefined();
  });
});

function expectsTerminal(events: ZCodeSessionEvent[]): void {
  expect(events.map((event) => event.type)).toEqual([
    "turn.started",
    "part.delta",
    "part.upserted",
    "turn.completed",
  ]);
  expect(events.at(-1)?.payload).toMatchObject({
    resultType: "cancelled",
    response: "partial",
  });
}
