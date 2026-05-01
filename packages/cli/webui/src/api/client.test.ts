import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectEvents, fetchState, sendMessage, stopTurn } from "./client.js";
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
