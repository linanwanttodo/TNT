import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  approve: vi.fn().mockResolvedValue(undefined),
}));

import { useSessionStore } from "./session-store.js";
import type { AgentEvent } from "../types/agent-events.js";

const base = { sessionId: "s1", turnId: "t1", timestamp: 0 };

type EventInput = AgentEvent extends infer E
  ? E extends { seq: number }
    ? Omit<E, "sessionId" | "turnId" | "timestamp" | "seq">
    : never
  : never;

function ev(seq: number, rest: EventInput) {
  return { ...base, seq, ...rest } as AgentEvent;
}

function dispatch(event: AgentEvent) {
  useSessionStore.getState().applyEvent(event);
}

describe("session store", () => {
  beforeEach(() => {
    useSessionStore.setState({
      items: [],
      streaming: null,
      reasoning: null,
      isWaiting: false,
      pendingPermission: null,
      notices: [],
      status: "live",
      queueLength: 0,
      seenTurnId: null,
      seenSeq: -1,
    });
  });

  it("concatenates content deltas into the streaming buffer", () => {
    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    dispatch(ev(2, { type: "content.delta", delta: "hel" }));
    dispatch(ev(3, { type: "content.delta", delta: "lo" }));
    const s = useSessionStore.getState();
    expect(s.streaming).toBe("hello");
    expect(s.isWaiting).toBe(true);
  });

  it("settles the streaming buffer into items on turn.completed", () => {
    dispatch(ev(1, { type: "content.delta", delta: "answer" }));
    dispatch(ev(2, { type: "turn.completed", content: undefined }));
    const s = useSessionStore.getState();
    expect(s.streaming).toBeNull();
    expect(s.isWaiting).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ role: "assistant", text: "answer" });
  });

  it("tracks reasoning deltas separately from content", () => {
    dispatch(ev(1, { type: "reasoning.delta", delta: "think" }));
    const s = useSessionStore.getState();
    expect(s.reasoning).toBe("think");
    expect(s.streaming).toBeNull();
  });

  it("tool.started creates a tool card and tool.finished settles it", () => {
    dispatch(
      ev(1, {
        type: "tool.started",
        toolCallId: "c1",
        toolName: "bash",
        args: { cmd: "ls" },
      }),
    );
    expect(useSessionStore.getState().items.at(-1)).toMatchObject({
      kind: "tool",
      toolName: "bash",
      status: "calling",
    });
    dispatch(
      ev(2, {
        type: "tool.finished",
        toolCallId: "c1",
        toolName: "bash",
        status: "done",
        result: "out",
      }),
    );
    expect(useSessionStore.getState().items.at(-1)).toMatchObject({
      kind: "tool",
      toolName: "bash",
      status: "done",
      result: "out",
    });
  });

  it("permission.requested sets pendingPermission and approve clears it", async () => {
    dispatch(
      ev(1, {
        type: "permission.requested",
        requestId: "r1",
        toolName: "bash",
        toolArgs: { cmd: "rm" },
      }),
    );
    expect(useSessionStore.getState().pendingPermission).toMatchObject({
      requestId: "r1",
      toolName: "bash",
    });
    useSessionStore.getState().approve(true);
    await vi.waitFor(() =>
      expect(useSessionStore.getState().pendingPermission).toBeNull(),
    );
  });

  it("turn.interrupted clears waiting and streaming", () => {
    dispatch(ev(1, { type: "content.delta", delta: "part" }));
    dispatch(ev(2, { type: "turn.interrupted", reason: "user" }));
    const s = useSessionStore.getState();
    expect(s.isWaiting).toBe(false);
    expect(s.streaming).toBeNull();
  });

  it("turn.failed records the error and clears waiting", () => {
    dispatch(ev(1, { type: "turn.failed", message: "boom" }));
    const s = useSessionStore.getState();
    expect(s.isWaiting).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: "error", text: "boom" });
  });

  it("notices accumulate and queue.changed updates queueLength", () => {
    dispatch(ev(1, { type: "notice", message: "n1" }));
    dispatch(ev(2, { type: "queue.changed", length: 2 }));
    const s = useSessionStore.getState();
    expect(s.notices).toEqual(["n1"]);
    expect(s.queueLength).toBe(2);
  });

  it("user messages are appended by send", () => {
    useSessionStore.getState().send("hi");
    expect(useSessionStore.getState().items.at(-1)).toMatchObject({
      role: "user",
      text: "hi",
    });
    expect(useSessionStore.getState().isWaiting).toBe(true);
  });

  it("a failed send reverts waiting and records an error", async () => {
    const { sendMessage } = await import("../api/client.js");
    (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("POST /message failed: 500"),
    );
    await useSessionStore.getState().send("hi");
    const s = useSessionStore.getState();
    expect(s.isWaiting).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: "error" });
  });

  it("a failed approve keeps the permission pending", async () => {
    dispatch(
      ev(1, {
        type: "permission.requested",
        requestId: "r1",
        toolName: "bash",
        toolArgs: { cmd: "rm" },
      }),
    );
    const { approve } = await import("../api/client.js");
    (approve as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("POST /permission failed: 500"),
    );
    await useSessionStore.getState().approve(true);
    expect(useSessionStore.getState().pendingPermission).toMatchObject({
      requestId: "r1",
    });
  });

  it("hydrate seeds the transcript and a pending permission from /state", () => {
    useSessionStore.getState().hydrate({
      history: [
        { message: { role: "user", content: "list files" } },
        { message: { role: "assistant", content: "a b c" } },
      ],
      pendingPermission: {
        requestId: "r9",
        toolName: "bash",
        toolArgs: { cmd: "ls" },
        toolCallPreview: [{ text: "ls" }],
      },
    });
    const s = useSessionStore.getState();
    expect(s.items).toEqual([
      { kind: "message", role: "user", text: "list files" },
      { kind: "message", role: "assistant", text: "a b c" },
    ]);
    expect(s.pendingPermission).toEqual({
      requestId: "r9",
      toolName: "bash",
      toolArgs: { cmd: "ls" },
      preview: [{ text: "ls" }],
    });
  });
});
