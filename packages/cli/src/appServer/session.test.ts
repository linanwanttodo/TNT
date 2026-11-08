import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { zcodeSessionEventSchema } from "@zcode/shared";
import type { ChatHistoryItem } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serviceContainer } from "../services/ServiceContainer.js";
import { createSession } from "../session/index.js";
import { sessionStore, setMessageTimestamp } from "../session/store.js";

import { AppServerProtocol, PROTOCOL_METHOD_NOT_FOUND } from "./protocol.js";
import { SessionRuntimeStore } from "./runtime.js";
import { SessionHandlers, type ModelLookup } from "./session.js";
import { SessionRegistry } from "./sessionRegistry.js";

interface RecordedMessage {
  id?: unknown;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

class RecordingSender {
  readonly messages: RecordedMessage[] = [];

  async send(message: unknown): Promise<void> {
    this.messages.push(message as RecordedMessage);
  }
}

const modelLookup: ModelLookup = {
  getAvailableChatModels: () => [
    { provider: "anthropic", name: "claude-sonnet-4-5", index: 0 },
  ],
};

function historyItem(message: ChatHistoryItem["message"]): ChatHistoryItem {
  return { message, contextItems: [] };
}

describe("SessionHandlers", () => {
  let root: string;
  let workspace: string;
  let sender: RecordingSender;
  let handlers: SessionHandlers;
  let previousGlobalDir: string | undefined;

  beforeEach(() => {
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-app-server-session-"));
    process.env.TNT_GLOBAL_DIR = root;
    sessionStore.clearAll();
    workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    sender = new RecordingSender();
    handlers = new SessionHandlers({ sender, modelLookup });
  });

  afterEach(() => {
    sessionStore.releaseAll();
    fs.rmSync(root, { recursive: true, force: true });
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
  });

  function workspaceRef(): { workspacePath: string; workspaceKey: string } {
    return { workspacePath: workspace, workspaceKey: workspace };
  }

  it("creates a session, lists it, and reads the same snapshot back", async () => {
    const created = await handlers.create({ workspace: workspaceRef() });
    const sessionId = created.session.sessionId;

    const list = await handlers.list({ workspace: workspaceRef() });
    expect(list.sessions.map((session) => session.sessionId)).toContain(
      sessionId,
    );

    const read = await handlers.read({ sessionId });
    expect(read).toEqual(created);
  });

  it("hides a closed session from list while keeping it readable", async () => {
    const created = await handlers.create({ workspace: workspaceRef() });
    const sessionId = created.session.sessionId;

    await expect(handlers.close({ sessionId })).resolves.toEqual({
      closed: true,
    });

    const list = await handlers.list({ workspace: workspaceRef() });
    expect(list.sessions.map((session) => session.sessionId)).not.toContain(
      sessionId,
    );

    const read = await handlers.read({ sessionId });
    expect(read.session.sessionId).toBe(sessionId);
  });

  it("returns closed false for a session that does not exist", async () => {
    await expect(
      handlers.close({ sessionId: "missing-session" }),
    ).resolves.toEqual({ closed: false });
  });

  it("resumes the persisted session and keeps its updated title", async () => {
    const created = await handlers.create({ workspace: workspaceRef() });
    const sessionId = created.session.sessionId;
    await handlers.setTitle(sessionId, "Renamed session", "custom");

    const resumed = await handlers.resume({ sessionId });

    expect(resumed.session.sessionId).toBe(sessionId);
    expect(resumed.session.title).toBe("Renamed session");
    expect(resumed.session.workspace.workspacePath).toBe(workspace);
  });

  it("rejects resume for an unknown session", async () => {
    await expect(
      handlers.resume({ sessionId: "missing-session" }),
    ).rejects.toThrow("Session not found: missing-session");
  });

  it("sets a known model and persists it in the snapshot", async () => {
    const created = await handlers.create({ workspace: workspaceRef() });
    const sessionId = created.session.sessionId;
    const model = { providerId: "anthropic", modelId: "claude-sonnet-4-5" };

    const updated = await handlers.setModel({ sessionId, model });

    expect(updated.settings.model.current).toEqual(model);
    expect(updated.session.model).toEqual(model);

    const read = await handlers.read({ sessionId });
    expect(read.session.model).toEqual(model);
  });

  it.each([
    [{ providerId: "anthropic", modelId: "does-not-exist" }],
    [{ providerId: "openai", modelId: "claude-sonnet-4-5" }],
  ])("rejects an unknown model %o", async (model) => {
    const created = await handlers.create({ workspace: workspaceRef() });

    await expect(
      handlers.setModel({ sessionId: created.session.sessionId, model }),
    ).rejects.toThrow(`Unknown model: ${model.providerId}/${model.modelId}`);
  });

  it("reports a method error when the model service is not ready", async () => {
    const created = await handlers.create({ workspace: workspaceRef() });
    const withoutModelService = new SessionHandlers({
      sender,
      modelLookup: null,
    });

    await expect(
      withoutModelService.setModel({
        sessionId: created.session.sessionId,
        model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
      }),
    ).rejects.toThrow("Model service is not ready");
  });

  it("windows messages after an id and by limit", async () => {
    const sessionId = "seeded-messages";
    createSession(
      [
        historyItem({ role: "user", content: "one" }),
        historyItem({ role: "assistant", content: "two" }),
        historyItem({ role: "user", content: "three" }),
      ],
      sessionId,
      { source: "serve", persistEmpty: true },
    );

    const all = await handlers.messages({ sessionId });
    expect(all.messages).toHaveLength(3);

    const afterId = all.messages[0].info.messageId;
    const windowed = await handlers.messages({
      sessionId,
      afterMessageId: afterId,
      limit: 1,
    });

    expect(windowed.messages).toHaveLength(1);
    expect(windowed.messages[0].info.messageId).toBe(
      all.messages[1].info.messageId,
    );
  });

  it("emits one session/event titleUpdated envelope only when the title changes", async () => {
    const runtimes = new SessionRuntimeStore();
    const handler = new SessionHandlers({ sender, modelLookup, runtimes });
    const emitted: unknown[] = [];
    const created = await handler.create({ workspace: workspaceRef() });
    const sessionId = created.session.sessionId;
    runtimes.subscribe(sessionId, (event) => emitted.push(event));

    await handler.setTitle(sessionId, "Generated title", "generated");
    await handler.setTitle(sessionId, "Generated title", "generated");

    expect(emitted).toHaveLength(1);
    expect(zcodeSessionEventSchema.parse(emitted[0])).toEqual({
      eventId: `${sessionId}:event-1`,
      sessionId,
      seq: 1,
      timestamp: expect.any(Number),
      type: "session.titleUpdated",
      payload: {
        previousTitle: "Untitled Session",
        title: "Generated title",
        source: "generated",
      },
    });
  });

  it("rejects a create request without a workspace", async () => {
    await expect(handlers.create({})).rejects.toThrow("Invalid params");
  });

  it("validates a model supplied to create", async () => {
    await expect(
      handlers.create({
        workspace: workspaceRef(),
        model: { providerId: "anthropic", modelId: "does-not-exist" },
      }),
    ).rejects.toThrow("Unknown model: anthropic/does-not-exist");
  });

  it("persists plan mode for plan and build for every other mode", async () => {
    const plan = await handlers.create({
      workspace: workspaceRef(),
      mode: "plan",
    });
    expect(plan.session.mode).toBe("plan");
    expect(plan.settings.mode.current).toBe("plan");

    const build = await handlers.create({
      workspace: workspaceRef(),
      mode: "yolo",
    });
    expect(build.session.mode).toBe("build");
  });

  it("persists and echoes workspaceIdentity as the workspace key", async () => {
    const created = await handlers.create({
      workspace: {
        workspacePath: workspace,
        workspaceKey: "ignored-by-the-server",
        workspaceIdentity: "remote-workspace-1",
      },
    });
    expect(created.session.workspace).toMatchObject({
      workspacePath: workspace,
      workspaceIdentity: "remote-workspace-1",
      workspaceKey: "remote-workspace-1",
    });

    const restarted = new SessionHandlers({ sender, modelLookup });
    const read = await restarted.read({
      sessionId: created.session.sessionId,
    });
    expect(read.session.workspace.workspaceIdentity).toBe("remote-workspace-1");
    expect(read.session.workspace.workspaceKey).toBe("remote-workspace-1");
  });

  it("imports conversation messages and their timestamps instead of only the title", async () => {
    const created = await handlers.create({
      workspace: workspaceRef(),
      importedHistory: {
        source: "claudeCode",
        title: "Imported conversation",
        createdAt: 1_700_000_000_000,
        messages: [
          {
            role: "user",
            content: "imported one",
            timestamp: 1_700_000_001_000,
          },
          {
            role: "assistant",
            content: "imported two",
            timestamp: 1_700_000_002_000,
          },
        ],
      },
    });
    expect(created.session.title).toBe("Imported conversation");

    const restarted = new SessionHandlers({ sender, modelLookup });
    const read = await restarted.read({
      sessionId: created.session.sessionId,
    });
    expect(read.messages).toHaveLength(2);
    expect(read.messages[0].info.time.created).toBe(1_700_000_001_000);
    expect(read.messages[1].info.time.created).toBe(1_700_000_002_000);
  });

  it("imports a shared-context payload as one user message", async () => {
    const created = await handlers.create({
      workspace: workspaceRef(),
      importedHistory: {
        source: "sharedContext",
        title: "Shared context",
        createdAt: 1_700_000_003_000,
        markdown: "# Shared notes",
        provenance: {
          shareId: "share-1",
          projectionSha256: "a".repeat(64),
          artifactSetSha256: "b".repeat(64),
          formatterVersion: 1,
          markdownSha256: "c".repeat(64),
          installedArtifacts: [],
        },
      },
    });

    const read = await handlers.read({
      sessionId: created.session.sessionId,
    });
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0].info.time.created).toBe(1_700_000_003_000);
  });

  it("hides a closed session after a restart and restores it on resume", async () => {
    const created = await handlers.create({ workspace: workspaceRef() });
    const sessionId = created.session.sessionId;

    await handlers.close({ sessionId });

    const restarted = new SessionHandlers({ sender, modelLookup });
    const hidden = await restarted.list({ workspace: workspaceRef() });
    expect(hidden.sessions.map((session) => session.sessionId)).not.toContain(
      sessionId,
    );
    await expect(restarted.read({ sessionId })).resolves.toMatchObject({
      session: { sessionId },
    });

    await restarted.resume({ sessionId });
    const visible = await restarted.list({ workspace: workspaceRef() });
    expect(visible.sessions.map((session) => session.sessionId)).toContain(
      sessionId,
    );
  });

  it("applies the list limit after hiding closed sessions", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await handlers.create({ workspace: workspaceRef() });
      ids.push(created.session.sessionId);
    }
    await handlers.close({ sessionId: ids[0] as string });

    const list = await handlers.list({
      workspace: workspaceRef(),
      limit: 2,
    });

    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.map((session) => session.sessionId)).not.toContain(
      ids[0],
    );
  });

  it("filters the list by workspace path", async () => {
    const other = path.join(root, "other-workspace");
    fs.mkdirSync(other, { recursive: true });
    const mine = await handlers.create({ workspace: workspaceRef() });
    const theirs = await handlers.create({
      workspace: { workspacePath: other, workspaceKey: other },
    });

    const list = await handlers.list({ workspace: workspaceRef() });
    const listed = list.sessions.map((session) => session.sessionId);
    expect(listed).toContain(mine.session.sessionId);
    expect(listed).not.toContain(theirs.session.sessionId);
  });

  it("derives a subagent session kind from the stored session type", async () => {
    const session = createSession([], "subagent-session", {
      source: "subagent",
      persistEmpty: false,
    });
    session.subagentType = "code-reviewer";
    sessionStore.sync(session);

    const read = await handlers.read({ sessionId: "subagent-session" });
    expect(read.session.sessionKind).toBe("subagent_child");
  });

  it("honors messageLimit as a tail window", async () => {
    const sessionId = "tail-window";
    createSession(
      [
        historyItem({ role: "user", content: "one" }),
        historyItem({ role: "assistant", content: "two" }),
        historyItem({ role: "user", content: "three" }),
      ],
      sessionId,
      { source: "serve", persistEmpty: true },
    );

    const read = await handlers.read({ sessionId, messageLimit: 2 });
    expect(read.messages).toHaveLength(2);
    const texts = read.messages.map((message) => {
      const part = message.parts.find((candidate) => candidate.type === "text");
      return part && "text" in part ? part.text : "";
    });
    expect(texts).toEqual(["two", "three"]);
  });

  it("honors afterSeq as a relative window and rejects a cursor that is ahead", async () => {
    const runtimes = new SessionRuntimeStore();
    const handler = new SessionHandlers({ sender, modelLookup, runtimes });
    const sessionId = "relative-window";
    const before = historyItem({ role: "user", content: "before" });
    const after = historyItem({ role: "assistant", content: "after" });
    setMessageTimestamp(before, "2026-03-01T00:00:01.000Z");
    setMessageTimestamp(after, "2026-03-01T00:00:03.000Z");
    createSession([before, after], sessionId, {
      source: "serve",
      persistEmpty: true,
    });
    runtimes.append(
      sessionId,
      "session.updated",
      { sessionId },
      Date.parse("2026-03-01T00:00:02.000Z"),
      null,
    );

    const read = await handler.read({ sessionId, afterSeq: 1 });
    expect(read.messages).toHaveLength(1);
    expect(read.messages[0].info.role).toBe("assistant");

    await expect(
      handler.read({ sessionId, afterSeq: 9 }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("projects an index snapshot without reasoning or tool payloads", async () => {
    const sessionId = "index-profile";
    createSession(
      [
        historyItem({ role: "user", content: "go" }),
        {
          message: {
            role: "assistant",
            content: "done",
            toolCalls: [
              {
                id: "call-index",
                type: "function",
                function: { name: "read", arguments: "{}" },
              },
            ],
          },
          contextItems: [],
          reasoning: { active: false, text: "private thought", startAt: 0 },
          toolCallStates: [
            {
              toolCallId: "call-index",
              toolCall: {
                id: "call-index",
                type: "function",
                function: { name: "read", arguments: "{}" },
              },
              status: "done",
              parsedArgs: { path: "secret.txt" },
              output: [
                { content: "secret body", name: "secret.txt", description: "" },
              ],
            },
          ],
        },
      ],
      sessionId,
      { source: "serve", persistEmpty: true },
    );

    const read = await handlers.read({
      sessionId,
      contentProfile: "index",
    });
    const assistant = read.messages.find(
      (message) => message.info.role === "assistant",
    );
    const reasoning = assistant?.parts.find(
      (part) => part.type === "reasoning",
    );
    expect(reasoning && "text" in reasoning ? reasoning.text : undefined).toBe(
      "",
    );
    const tool = assistant?.parts.find((part) => part.type === "tool");
    expect(tool?.type).toBe("tool");
    if (tool?.type === "tool" && tool.state.status === "completed") {
      expect(tool.state.output).toBe("");
      expect(tool.state.input).toEqual({});
    }
  });

  it("reports a non-zero resume cursor once events exist", async () => {
    const runtimes = new SessionRuntimeStore();
    const handler = new SessionHandlers({ sender, modelLookup, runtimes });
    const created = await handler.create({ workspace: workspaceRef() });
    const sessionId = created.session.sessionId;
    runtimes.append(sessionId, "session.updated", { sessionId }, 1_000, null);

    const read = await handler.read({ sessionId });
    expect(read.runtime.eventSeq).toBe(1);
    expect(read.runtime.stateRevision).toBe(1);
  });

  it("matches the model id through the real service-container fallback", async () => {
    const spy = vi.spyOn(serviceContainer, "getSync").mockReturnValue({
      state: "ready",
      value: {
        assistant: {
          models: [
            {
              provider: "anthropic",
              name: "Claude Sonnet 4.5",
              model: "claude-sonnet-4-5",
              roles: ["chat"],
            },
          ],
        },
      },
      error: null,
    } as never);
    try {
      const created = await handlers.create({ workspace: workspaceRef() });
      const fallback = new SessionHandlers({ sender });
      const updated = await fallback.setModel({
        sessionId: created.session.sessionId,
        model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
      });

      expect(updated.session.model).toEqual({
        providerId: "anthropic",
        modelId: "claude-sonnet-4-5",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("reports the model service as internal server state, not invalid params", async () => {
    const created = await handlers.create({ workspace: workspaceRef() });
    const withoutModelService = new SessionHandlers({
      sender,
      modelLookup: null,
    });

    await expect(
      withoutModelService.setModel({
        sessionId: created.session.sessionId,
        model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
      }),
    ).rejects.toMatchObject({ code: -32603 });
  });
});

describe("AppServerProtocol session methods", () => {
  let root: string;
  let previousGlobalDir: string | undefined;

  beforeEach(() => {
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-app-server-wire-"));
    process.env.TNT_GLOBAL_DIR = root;
    sessionStore.clearAll();
  });

  afterEach(() => {
    sessionStore.releaseAll();
    fs.rmSync(root, { recursive: true, force: true });
    if (previousGlobalDir === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    }
  });

  it.each([
    "session/create",
    "session/resume",
    "session/list",
    "session/read",
    "session/messages",
    "session/close",
    "session/setModel",
  ])("registers %s instead of answering method-not-found", async (method) => {
    const sender = new RecordingSender();
    const protocol = new AppServerProtocol(sender, new SessionRegistry(root));

    await protocol.handle({ id: method, method, params: {} });

    expect(sender.messages[0]?.error?.code).not.toBe(PROTOCOL_METHOD_NOT_FOUND);
  });

  it("answers invalid params with the exact -32602 envelope", async () => {
    const sender = new RecordingSender();
    const protocol = new AppServerProtocol(sender, new SessionRegistry(root));

    await protocol.handle({ id: "bad", method: "session/read", params: {} });

    expect(sender.messages[0]).toEqual({
      id: "bad",
      error: {
        code: -32602,
        message: expect.stringMatching(/^Invalid params:/),
      },
    });
  });

  it("initializes model services before create or setModel validates a model", async () => {
    const sender = new RecordingSender();
    const ensureServices = vi.fn(async () => undefined);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const protocol = new AppServerProtocol(sender, new SessionRegistry(root), {
      modelLookup,
      ensureServices,
    });
    const model = { providerId: "anthropic", modelId: "claude-sonnet-4-5" };

    await protocol.handle({
      id: "create",
      method: "session/create",
      params: {
        workspace: { workspacePath: workspace, workspaceKey: workspace },
        model,
      },
    });
    const created = sender.messages.find((message) => message.id === "create")
      ?.result as {
      session: { sessionId: string };
    };
    await protocol.handle({
      id: "model",
      method: "session/setModel",
      params: { sessionId: created.session.sessionId, model },
    });

    expect(ensureServices).toHaveBeenCalledTimes(2);
    expect(
      sender.messages.find((message) => message.id === "model")?.result,
    ).toBeDefined();
    protocol.dispose();
  });
});
