import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppServerProtocol } from "../appServer/protocol.js";
import { SessionRegistry } from "../appServer/sessionRegistry.js";
import { subscribeAgentEvents } from "../protocol/eventBus.js";
import { createSession } from "../session/index.js";
import { sessionStore } from "../session/store.js";
import { resetLiveHubForTesting } from "../webuiZcode/liveHub.js";
import { liveHub, type LiveRuntime } from "../webuiZcode/liveHub.js";

/**
 * The whole share, in one process: the browser creates a session (the screen's
 * conversation continues), sends text (the screen's turn answers), and reads
 * the projected events back over the subscribe stream. The screen side is a
 * stub that mimics the TUI: handleUserMessage runs a turn by publishing the
 * started/delta/completed projection.
 */

function makeSender() {
  const messages: Array<Record<string, unknown>> = [];
  return {
    messages,
    async send(message: unknown): Promise<void> {
      messages.push(message as Record<string, unknown>);
    },
    notifications(method: string) {
      return messages.filter((m) => m.method === method);
    },
    result(id: unknown) {
      return messages.find(
        (m) => m.id === id && (m.result !== undefined || m.error !== undefined),
      );
    },
  };
}

function makeTuiRuntime(): LiveRuntime & {
  received: string[];
  runTurnProjection: (text: string) => void;
} {
  const received: string[] = [];
  return {
    runtimeId: "tui-e2e",
    received,
    handleUserMessage: (text: string) => {
      received.push(text);
      // The TUI's useChat publishes this projection while a turn runs.
      liveHub.publishTurnStarted(text);
      liveHub.publishContent(`answer to ${text}`);
      liveHub.publishTurnCompleted({ content: `answer to ${text}` });
    },
    session: () => ({
      sessionId: "tui-session-1",
      title: "live",
      workspaceDirectory: "/tmp",
    }),
    workingDir: () => "/tmp",
    providerInfo: () => ({ provider: "test", model: "model-a" }),
    runCommand: async () => "screen status",
    selectSession: vi.fn(),
    runTurnProjection: (text: string) => {
      liveHub.publishTurnStarted(text);
      liveHub.publishTurnCompleted({ content: text });
    },
  };
}

const WORKSPACE = {
  workspacePath: "/tmp",
  workspaceIdentity: "tmp",
  workspaceKey: "/tmp",
};

describe("shared conversation over the ZCode RPC", () => {
  let sender: ReturnType<typeof makeSender>;
  let protocol: AppServerProtocol;
  let tui: ReturnType<typeof makeTuiRuntime>;
  let sessionId: string;

  beforeEach(() => {
    resetLiveHubForTesting();
    sender = makeSender();
    tui = makeTuiRuntime();
    // Seed the screen's conversation, the way the TUI's saveSession does.
    const live = createSession([], "tui-session-1");
    sessionStore.sync(live);
    protocol = new AppServerProtocol(sender, new SessionRegistry("/tmp"), {
      ensureServices: async () => undefined,
      acceptRemoteText: async (text: string) => {
        if (!liveHub.isBound()) return false;
        const outcome = await liveHub.acceptRemoteText(text);
        return outcome.kind !== "unbound";
      },
      // The screen's session keeps running when the browser picks a directory.
      reuseLiveSession: () => (liveHub.isBound() ? live : null),
      onLiveSessionResumed: (sessionId: string) => {
        void Promise.resolve(tui.selectSession?.(sessionId)).then(() => {
          liveHub.notifySessionChanged();
        });
      },
    });
    // The screen side binds, as TUIChat does when /webui starts.
    liveHub.bind(tui);
  });

  afterEach(() => {
    protocol.dispose();
    resetLiveHubForTesting();
  });

  it("keeps the screen's conversation across a directory pick", async () => {
    await protocol.handle({
      id: "create",
      method: "session/create",
      params: { workspace: WORKSPACE },
    });
    const response = sender.result("create")?.result as {
      session: { sessionId: string };
    };
    expect(response.session.sessionId).toBe("tui-session-1");
  });

  it("delivers browser text to the screen's turn and streams the answer back", async () => {
    const busEvents: string[] = [];
    const stopBus = subscribeAgentEvents((e) => busEvents.push(e.type));
    await protocol.handle({
      id: "create",
      method: "session/create",
      params: { workspace: WORKSPACE },
    });
    await protocol.handle({
      id: "sub",
      method: "session/subscribe",
      params: {
        sessionId: "tui-session-1",
        deliveryKind: "desktop-continuous",
        includeSnapshot: true,
      },
    });
    await protocol.handle({
      id: "send",
      method: "session/send",
      params: { sessionId: "tui-session-1", content: "请修复登录" },
    });
    // The turn runs synchronously inside handleUserMessage in this stub, so
    // the projection has already been published by the time send resolves.
    expect(tui.received).toEqual(["请修复登录"]);
    stopBus();

    const events = sender
      .notifications("session/event")
      .map((m) => (m.params as { type?: string }).type);
    expect(events).toContain("turn.started");
    expect(events).toContain("part.delta");
    expect(events).toContain("turn.completed");

    const input = sender
      .notifications("session/event")
      .map((m) => m.params as { payload: Record<string, unknown> })
      .map((m) => m.payload)
      .find((payload) => payload.input === "请修复登录");
    expect(input).toBeDefined();
  });

  it("runs a browser slash command on the screen without reaching the model", async () => {
    await protocol.handle({
      id: "create",
      method: "session/create",
      params: { workspace: WORKSPACE },
    });
    await protocol.handle({
      id: "sub",
      method: "session/subscribe",
      params: {
        sessionId: "tui-session-1",
        deliveryKind: "desktop-continuous",
      },
    });
    await protocol.handle({
      id: "send",
      method: "session/send",
      params: { sessionId: "tui-session-1", content: "/status" },
    });

    expect(tui.received).toEqual([]);
    const deltas = sender
      .notifications("session/event")
      .map((m) => m.params as { payload: Record<string, unknown> })
      .filter((m) => m.payload.delta === "screen status");
    expect(deltas.length).toBeGreaterThan(0);
  });

  it("moves the screen when the browser resumes a listed session", async () => {
    sessionStore.sync(createSession([], "older-session"));
    await protocol.handle({
      id: "resume",
      method: "session/resume",
      params: { sessionId: "older-session" },
    });
    expect(tui.selectSession).toHaveBeenCalledWith("older-session");
  });
});
