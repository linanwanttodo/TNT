import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { zcodeSessionEventSchema } from "@zcode/shared";
import type { ChatHistoryItem } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "../session/index.js";
import { sessionStore } from "../session/store.js";

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
});
