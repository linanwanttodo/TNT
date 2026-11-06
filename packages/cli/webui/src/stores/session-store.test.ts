import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  approve: vi.fn().mockResolvedValue(undefined),
  fetchState: vi.fn().mockResolvedValue({
    session: { sessionId: "", title: "", history: [] },
    pendingPermission: null,
  }),
  startSession: vi.fn().mockResolvedValue({
    session: { sessionId: "", title: "", history: [] },
    pendingPermission: null,
  }),
  switchSession: vi.fn().mockResolvedValue({
    session: { sessionId: "", title: "", history: [] },
    pendingPermission: null,
  }),
  fetchModels: vi.fn().mockResolvedValue({
    available: true,
    models: [],
    current: null,
  }),
  chooseModel: vi.fn().mockResolvedValue({
    index: 1,
    name: "gpt-5.2",
    provider: "openai",
    current: true,
  }),
  fetchWorktrees: vi.fn().mockResolvedValue({
    available: true,
    worktrees: [],
    current: null,
    switchable: false,
  }),
  chooseWorktree: vi.fn().mockResolvedValue({
    path: "/repo/side",
    branch: "side",
    head: "b".repeat(40),
    detached: false,
    bare: false,
  }),
}));

import * as client from "../api/client.js";
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
      sessionId: null,
      title: null,
      chatModelTitle: null,
      models: [],
      currentModel: null,
      worktrees: [],
      currentWorktree: null,
      worktreeSwitchable: false,
      worktreeChosen: false,
      isProcessing: false,
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
      flushedSegments: false,
    });
    vi.mocked(client.fetchModels).mockClear();
    vi.mocked(client.chooseModel).mockClear();
    vi.mocked(client.fetchWorktrees).mockClear();
    vi.mocked(client.chooseWorktree).mockClear();
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

  it("settles the text emitted before a tool call above the tool card", () => {
    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    dispatch(ev(2, { type: "content.delta", delta: "Let me read it." }));
    dispatch(
      ev(3, { type: "tool.started", toolCallId: "c1", toolName: "Read" }),
    );
    dispatch(
      ev(4, {
        type: "tool.finished",
        toolCallId: "c1",
        toolName: "Read",
        status: "done",
        result: "42 lines",
      }),
    );
    dispatch(ev(5, { type: "content.delta", delta: "Done." }));
    // The server's real payload: streamChatResponse returns the whole turn's
    // text (fullResponse accumulates every round), not just the tail.
    dispatch(
      ev(6, { type: "turn.completed", content: "Let me read it.Done." }),
    );
    // Without the flush the prose only lands at turn.completed, i.e. below
    // the card it caused.
    expect(useSessionStore.getState().items).toEqual([
      { kind: "message", role: "assistant", text: "Let me read it." },
      {
        kind: "tool",
        toolCallId: "c1",
        toolName: "Read",
        status: "done",
        result: "42 lines",
        args: undefined,
      },
      { kind: "message", role: "assistant", text: "Done.", changedFiles: [] },
    ]);
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
    // The shape is the server's: getCompleteStateSnapshot nests the
    // transcript under `session`, so a top-level `history` here would pin
    // the bug instead of the contract.
    useSessionStore.getState().hydrate({
      session: {
        history: [
          { message: { role: "user", content: "list files" } },
          { message: { role: "assistant", content: "a b c" } },
        ],
      },
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

  it("hydrate reads the transcript from the /state session envelope too", () => {
    useSessionStore.getState().hydrate({
      session: {
        history: [{ message: { role: "user", content: "nested" } }],
      },
      pendingPermission: null,
    });
    expect(useSessionStore.getState().items).toEqual([
      { kind: "message", role: "user", text: "nested" },
    ]);
  });

  it("switchTo clears the transcript, hydrates the new session and reports the id", async () => {
    const { switchSession } = await import("../api/client.js");
    const switchSessionMock = switchSession as ReturnType<typeof vi.fn>;
    switchSessionMock.mockResolvedValue({
      session: {
        sessionId: "old",
        title: "Old conversation",
        history: [
          { message: { role: "user", content: "earlier" } },
          { message: { role: "assistant", content: "answer" } },
        ],
      },
      pendingPermission: null,
    });

    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    dispatch(ev(2, { type: "content.delta", delta: "in flight" }));
    useSessionStore.setState({ items: [{ kind: "error", text: "stale" }] });

    const id = await useSessionStore.getState().switchTo("old");

    expect(id).toBe("old");
    const s = useSessionStore.getState();
    expect(s.items).toEqual([
      { kind: "message", role: "user", text: "earlier" },
      { kind: "message", role: "assistant", text: "answer" },
    ]);
    expect(s.streaming).toBeNull();
    expect(s.isWaiting).toBe(false);
    expect(s.seenTurnId).toBeNull();
  });

  it("switchTo keeps the old transcript when the server refuses", async () => {
    const { switchSession } = await import("../api/client.js");
    const switchSessionMock = switchSession as ReturnType<typeof vi.fn>;
    switchSessionMock.mockRejectedValue(
      new Error("POST /session/select failed: 404"),
    );

    useSessionStore.setState({ items: [{ kind: "error", text: "kept" }] });
    const id = await useSessionStore.getState().switchTo("missing");

    expect(id).toBeNull();
    expect(useSessionStore.getState().items).toEqual([
      { kind: "error", text: "kept" },
    ]);
    expect(useSessionStore.getState().notices).toContain(
      "POST /session/select failed: 404",
    );
  });

  it("startNew clears the transcript and hydrates the empty snapshot", async () => {
    const { startSession } = await import("../api/client.js");
    const startSessionMock = startSession as ReturnType<typeof vi.fn>;
    startSessionMock.mockResolvedValue({
      session: { sessionId: "fresh", title: "", history: [] },
      pendingPermission: null,
    });

    useSessionStore.setState({ items: [{ kind: "error", text: "old" }] });
    const id = await useSessionStore.getState().startNew();

    expect(id).toBe("fresh");
    expect(useSessionStore.getState().items).toEqual([]);
    expect(useSessionStore.getState().streaming).toBeNull();
  });

  it("session.changed drops the transcript and re-pulls the snapshot", async () => {
    const { fetchState } = await import("../api/client.js");
    const fetchStateMock = fetchState as ReturnType<typeof vi.fn>;
    fetchStateMock.mockResolvedValueOnce({
      session: {
        sessionId: "other",
        title: "Switched away",
        history: [{ message: { role: "user", content: "there" } }],
      },
      pendingPermission: null,
    });

    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    dispatch(ev(2, { type: "content.delta", delta: "partial" }));

    dispatch(ev(3, { type: "session.changed" }));

    const s = useSessionStore.getState();
    expect(s.items).toEqual([]);
    expect(s.streaming).toBeNull();
    expect(s.isWaiting).toBe(false);
    expect(s.seenTurnId).toBe("t1");
    expect(s.sessionId).toBeNull();

    // The snapshot the re-pull returns is applied once it arrives.
    await vi.waitFor(() =>
      expect(useSessionStore.getState().items).toEqual([
        { kind: "message", role: "user", text: "there" },
      ]),
    );
    expect(useSessionStore.getState().sessionId).toBe("other");
    expect(useSessionStore.getState().title).toBe("Switched away");
  });

  it("session.changed re-pull is skipped when a local switch landed first", async () => {
    dispatch(ev(1, { type: "session.changed" }));

    const { switchSession } = await import("../api/client.js");
    const switchSessionMock = switchSession as ReturnType<typeof vi.fn>;
    switchSessionMock.mockResolvedValue({
      session: {
        sessionId: "mine",
        title: "Mine",
        history: [],
      },
      pendingPermission: null,
    });
    await useSessionStore.getState().switchTo("mine");
    expect(useSessionStore.getState().sessionId).toBe("mine");

    // The late re-pull must not clobber the locally chosen session.
    const { fetchState } = await import("../api/client.js");
    const fetchStateMock = fetchState as ReturnType<typeof vi.fn>;
    fetchStateMock.mockResolvedValueOnce({
      session: { sessionId: "other", title: "Other", history: [] },
      pendingPermission: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useSessionStore.getState().sessionId).toBe("mine");
  });

  it("hydrate records the session id, title and model from the envelope", () => {
    useSessionStore.getState().hydrate({
      session: {
        sessionId: "abc",
        title: "Fix the login bug",
        chatModelTitle: "Sonnet",
        history: [{ message: { role: "user", content: "hi" } }],
      },
      pendingPermission: null,
    });
    const s = useSessionStore.getState();
    expect(s.sessionId).toBe("abc");
    expect(s.title).toBe("Fix the login bug");
    expect(s.chatModelTitle).toBe("Sonnet");
    expect(s.items).toEqual([{ kind: "message", role: "user", text: "hi" }]);
  });

  it("settles reasoning into the transcript when the answer starts", () => {
    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    dispatch(ev(2, { type: "reasoning.delta", delta: "first " }));
    dispatch(ev(3, { type: "reasoning.delta", delta: "then this" }));
    dispatch(ev(4, { type: "content.delta", delta: "the answer" }));

    const state = useSessionStore.getState();
    expect(state.items).toEqual([
      { kind: "reasoning", text: "first then this" },
    ]);
    expect(state.reasoning).toBeNull();
  });

  it("keeps thinking ahead of the tool call it led", () => {
    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    dispatch(ev(2, { type: "reasoning.delta", delta: "let me look" }));
    dispatch(
      ev(3, {
        type: "tool.started",
        toolCallId: "c1",
        toolName: "read_file",
        args: { path: "a.ts" },
      }),
    );

    expect(useSessionStore.getState().items.map((item) => item.kind)).toEqual([
      "reasoning",
      "tool",
    ]);
  });

  it("settles thinking that outlived the turn instead of dropping it", () => {
    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    dispatch(ev(2, { type: "reasoning.delta", delta: "almost done" }));
    dispatch(ev(3, { type: "turn.completed" }));

    expect(useSessionStore.getState().items.map((item) => item.kind)).toEqual([
      "reasoning",
      "message",
    ]);
  });

  it("hydrate restores reasoning, tool cards and the user's own words", () => {
    useSessionStore.getState().hydrate({
      session: {
        sessionId: "s1",
        history: [
          {
            message: {
              role: "user",
              content:
                "<system-reminder>\nrepo uses pnpm\n</system-reminder>\n\nhi",
            },
          },
          {
            message: { role: "assistant", content: "" },
            reasoning: { active: false, text: "the user said hi", startAt: 0 },
            toolCallStates: [
              {
                toolCallId: "c1",
                toolCall: { function: { name: "read_file" } },
                status: "done",
                parsedArgs: { path: "a.ts" },
                output: [{ text: "file body" }],
              },
            ],
          },
          { message: { role: "assistant", content: "hello back" } },
        ],
      },
      pendingPermission: null,
    });

    expect(useSessionStore.getState().items).toEqual([
      { kind: "message", role: "user", text: "hi" },
      { kind: "reasoning", text: "the user said hi" },
      {
        kind: "tool",
        toolCallId: "c1",
        toolName: "read_file",
        status: "done",
        args: { path: "a.ts" },
        result: "file body",
      },
      { kind: "message", role: "assistant", text: "hello back" },
    ]);
  });

  it("hydrates isProcessing from the /state snapshot", () => {
    useSessionStore.getState().hydrate({
      session: { sessionId: "s1", title: "", history: [] },
      isProcessing: true,
    });
    expect(useSessionStore.getState().isProcessing).toBe(true);
  });

  it("tracks the running turn on the server", () => {
    dispatch(ev(1, { type: "turn.started", model: "m", historyLength: 0 }));
    expect(useSessionStore.getState().isProcessing).toBe(true);
    dispatch(ev(2, { type: "turn.completed", content: "ok" }));
    expect(useSessionStore.getState().isProcessing).toBe(false);
  });

  it("loads the model list and names the current model", async () => {
    vi.mocked(client.fetchModels).mockResolvedValueOnce({
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
    });
    await useSessionStore.getState().refreshModels();
    expect(useSessionStore.getState().models).toHaveLength(2);
    expect(useSessionStore.getState().currentModel?.name).toBe(
      "Deepseek-V4.1-Flash",
    );
    expect(useSessionStore.getState().chatModelTitle).toBe(
      "Deepseek-V4.1-Flash",
    );
  });

  it("re-pulls the model list on a model.changed event", async () => {
    dispatch(ev(1, { type: "model.changed", model: "gpt-5.2" }));
    await Promise.resolve();
    expect(client.fetchModels).toHaveBeenCalled();
  });

  it("switches the model through the server", async () => {
    await useSessionStore.getState().pickModel(1);
    expect(client.chooseModel).toHaveBeenCalledWith(1);
    expect(useSessionStore.getState().currentModel?.name).toBe("gpt-5.2");
    expect(useSessionStore.getState().chatModelTitle).toBe("gpt-5.2");
  });

  it("loads the checkouts and their switchability", async () => {
    vi.mocked(client.fetchWorktrees).mockResolvedValueOnce({
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
    });
    await useSessionStore.getState().refreshWorktrees();
    expect(useSessionStore.getState().worktrees).toHaveLength(2);
    expect(useSessionStore.getState().currentWorktree?.path).toBe("/repo/main");
    expect(useSessionStore.getState().worktreeSwitchable).toBe(true);
  });

  it("re-pulls the checkouts on a workspace.changed event", async () => {
    dispatch(
      ev(1, { type: "workspace.changed", path: "/repo/side", branch: "side" }),
    );
    await Promise.resolve();
    expect(client.fetchWorktrees).toHaveBeenCalled();
  });

  it("moves the process through the server and marks the chip chosen", async () => {
    await useSessionStore.getState().pickWorktree("/repo/side");
    expect(client.chooseWorktree).toHaveBeenCalledWith("/repo/side");
    expect(useSessionStore.getState().currentWorktree?.branch).toBe("side");
    expect(useSessionStore.getState().worktreeChosen).toBe(true);
  });
});
