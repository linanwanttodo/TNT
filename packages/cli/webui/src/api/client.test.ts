import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseModel,
  chooseWorktree,
  connectEvents,
  fetchModels,
  fetchState,
  fetchWorktrees,
  sendMessage,
  startSession,
  stopTurn,
  switchSession,
} from "./client.js";
import type { AgentEvent } from "../types/agent-events.js";

class MockEventSource {
  static last: MockEventSource | null = null;
  static instances: MockEventSource[] = [];

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, ((ev: { data: string }) => void)[]>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.last = this;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: { data: string }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) });
    }
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  error() {
    this.readyState = 2;
    this.onerror?.();
  }
}

const base = {
  sessionId: "s1",
  turnId: "t1",
  seq: 1,
  timestamp: 0,
};

function deltaEvent(delta: string): AgentEvent {
  return { ...base, type: "content.delta", delta };
}

describe("api client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource,
    );
    MockEventSource.instances = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connectEvents delivers an event object to onEvent", async () => {
    const events: AgentEvent[] = [];
    const close = connectEvents(
      (e) => events.push(e),
      () => {},
    );
    const source = MockEventSource.last!;
    expect(source.url.endsWith("/events")).toBe(true);

    source.emit("content.delta", deltaEvent("hello"));
    expect(events).toEqual([deltaEvent("hello")]);
    close();
  });

  it("reports reconnecting on error and live after reopening", async () => {
    const statuses: string[] = [];
    connectEvents(
      () => {},
      (s) => statuses.push(s),
    );
    const first = MockEventSource.instances[0];

    first.error();
    expect(statuses).toEqual(["reconnecting"]);

    await vi.advanceTimersByTimeAsync(1000);
    const second = MockEventSource.instances[1];
    second.open();
    expect(statuses).toEqual(["reconnecting", "live"]);
  });

  it("backs off exponentially and caps at 10s", async () => {
    connectEvents(
      () => {},
      () => {},
    );
    const first = MockEventSource.instances[0];
    first.error();

    await vi.advanceTimersByTimeAsync(999);
    expect(MockEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockEventSource.instances).toHaveLength(2);

    MockEventSource.instances[1].error();
    await vi.advanceTimersByTimeAsync(1999);
    expect(MockEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockEventSource.instances).toHaveLength(3);

    MockEventSource.instances[2].error();
    await vi.advanceTimersByTimeAsync(4000);
    expect(MockEventSource.instances).toHaveLength(4);

    MockEventSource.instances[3].error();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockEventSource.instances).toHaveLength(5);
  });

  it("stop reconnecting on close()", async () => {
    const close = connectEvents(
      () => {},
      () => {},
    );
    MockEventSource.instances[0].error();
    close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("sendMessage posts to /message with the text", async () => {
    await sendMessage("hello");
    expect(fetch).toHaveBeenCalledWith(
      "/message",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
  });

  it("stopTurn posts to /pause", async () => {
    await stopTurn();
    expect(fetch).toHaveBeenCalledWith(
      "/pause",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("startSession posts to /session/new and returns the snapshot", async () => {
    const snapshot = {
      session: { sessionId: "fresh", title: "", history: [] },
      isProcessing: false,
      messageQueueLength: 0,
      pendingPermission: null,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(snapshot), { status: 200 }),
        ),
    );

    const state = await startSession();
    expect(fetch).toHaveBeenCalledWith(
      "/session/new",
      expect.objectContaining({ method: "POST" }),
    );
    expect(state.session.sessionId).toBe("fresh");
  });

  it("switchSession posts the sessionId and returns the snapshot", async () => {
    const snapshot = {
      session: { sessionId: "old", title: "Old", history: [] },
      isProcessing: false,
      messageQueueLength: 0,
      pendingPermission: null,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(snapshot), { status: 200 }),
        ),
    );

    const state = await switchSession("old");
    expect(fetch).toHaveBeenCalledWith(
      "/session/select",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: "old" }),
      }),
    );
    expect(state.session.sessionId).toBe("old");
  });

  it("fetchState parses the /state snapshot", async () => {
    const snapshot = {
      session: { sessionId: "s1", title: "t", history: [] },
      isProcessing: true,
      messageQueueLength: 0,
      pendingPermission: null,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(snapshot), { status: 200 }),
        ),
    );
    const state = await fetchState();
    expect(state.isProcessing).toBe(true);
    expect(state.session.sessionId).toBe("s1");
  });
});

describe("model and worktree api", () => {
  const modelsBody = {
    available: true,
    models: [
      {
        index: 0,
        name: "Deepseek-V4.1-Flash",
        provider: "deepseek",
        current: true,
      },
      { index: 1, name: "gpt-5.2", provider: "openai", current: false },
    ],
    current: {
      index: 0,
      name: "Deepseek-V4.1-Flash",
      provider: "deepseek",
      current: true,
    },
  };
  const worktreesBody = {
    available: true,
    worktrees: [
      {
        path: "/repo/main",
        branch: "main",
        head: "a".repeat(40),
        detached: false,
        bare: false,
      },
      {
        path: "/repo/side",
        branch: "side",
        head: "b".repeat(40),
        detached: false,
        bare: false,
      },
    ],
    current: {
      path: "/repo/main",
      branch: "main",
      head: "a".repeat(40),
      detached: false,
      bare: false,
    },
    switchable: true,
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource,
    );
    MockEventSource.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers model.changed and workspace.changed SSE events", () => {
    const events: AgentEvent[] = [];
    connectEvents(
      (e) => events.push(e),
      () => {},
    );
    const source = MockEventSource.last!;
    source.emit("model.changed", {
      ...base,
      type: "model.changed",
      model: "gpt-5.2",
    });
    source.emit("workspace.changed", {
      ...base,
      type: "workspace.changed",
      path: "/repo/side",
      branch: "side",
    });
    expect(events.map((e) => e.type)).toEqual([
      "model.changed",
      "workspace.changed",
    ]);
  });

  it("fetchModels gets the /models list and its current entry", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(modelsBody), { status: 200 }),
    );
    const body = await fetchModels();
    expect(fetch).toHaveBeenCalledWith("/models");
    expect(body.models).toHaveLength(2);
    expect(body.current?.name).toBe("Deepseek-V4.1-Flash");
  });

  it("chooseModel posts the index and returns the model now in use", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ model: modelsBody.models[1] }), {
        status: 200,
      }),
    );
    const model = await chooseModel(1);
    expect(fetch).toHaveBeenCalledWith(
      "/model",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ index: 1 }),
      }),
    );
    expect(model.name).toBe("gpt-5.2");
  });

  it("fetchWorktrees gets the /worktrees list and switchability", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(worktreesBody), { status: 200 }),
    );
    const body = await fetchWorktrees();
    expect(fetch).toHaveBeenCalledWith("/worktrees");
    expect(body.worktrees).toHaveLength(2);
    expect(body.switchable).toBe(true);
  });

  it("chooseWorktree posts the checkout path and returns the new one", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ worktree: worktreesBody.worktrees[1] }), {
        status: 200,
      }),
    );
    const worktree = await chooseWorktree("/repo/side");
    expect(fetch).toHaveBeenCalledWith(
      "/worktree",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/repo/side" }),
      }),
    );
    expect(worktree.branch).toBe("side");
  });
});
