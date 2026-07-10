import type { IZCodeAgentService } from "@zcode/services";
import { describe, expect, it, vi } from "vitest";

import { createZcodeSessionService } from "./session.js";
import { ZCODE_UNAVAILABLE_PREFIX } from "./stubs.js";

const WORKSPACE = "/tmp/zcode-session-workspace";
const SESSION = "session-1";

function snapshot(sessionId = SESSION): unknown {
  return { session: { sessionId } };
}

function fakeAgent(): IZCodeAgentService {
  return {
    initialize: vi.fn(async () => ({
      available: true,
      workspaceKey: WORKSPACE,
    })),
    createSession: vi.fn(async () => snapshot()),
    resumeSession: vi.fn(async () => snapshot()),
    listSessions: vi.fn(async () => [{ sessionId: SESSION }]),
    readSession: vi.fn(async () => snapshot()),
    readSessionMessages: vi.fn(async () => []),
    closeSession: vi.fn(async () => true),
    setModel: vi.fn(async () => snapshot()),
    getWorkspaceRuntimeIdentity: vi.fn(async () => {
      throw new Error(`${ZCODE_UNAVAILABLE_PREFIX}agent`);
    }),
    readWorkspacePresentation: vi.fn(async () => {
      throw new Error(`${ZCODE_UNAVAILABLE_PREFIX}agent`);
    }),
  } as unknown as IZCodeAgentService;
}

describe("ZCode session service adapter", () => {
  it("delegates the session surface to the agent service", async () => {
    const agent = fakeAgent();
    const service = createZcodeSessionService(agent);

    await service.initializeWorkspace({ workspacePath: WORKSPACE });
    expect(agent.initialize).toHaveBeenCalledWith({
      workspacePath: WORKSPACE,
    });

    await service.createSession({
      workspacePath: WORKSPACE,
      workspaceIdentity: "identity-1",
      sessionId: "preassigned",
      sessionTraceId: "trace-only",
      mode: "plan",
      model: { providerId: "test", modelId: "fake" },
      thoughtLevel: "high",
      mcpServers: [],
    });
    expect(agent.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: WORKSPACE,
        workspaceIdentity: "identity-1",
        sessionId: "preassigned",
        mode: "plan",
        thoughtLevel: "high",
      }),
    );
    const createArg = vi.mocked(agent.createSession).mock.calls[0]?.[0];
    expect(createArg).not.toHaveProperty("sessionTraceId");

    await service.resumeSession({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      model: { providerId: "test", modelId: "fake" },
      broadcastSnapshot: false,
    });
    expect(agent.resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: WORKSPACE,
        sessionId: SESSION,
      }),
    );

    await service.listSessions({ workspacePath: WORKSPACE, limit: 5 });
    await service.readSession({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      messageLimit: 2,
    });
    await service.readSessionMessages({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      limit: 3,
    });
    await service.setModel({
      workspacePath: WORKSPACE,
      sessionId: SESSION,
      model: { providerId: "test", modelId: "fake" },
    });
    await expect(
      service.closeSession({ workspacePath: WORKSPACE, sessionId: SESSION }),
    ).resolves.toBeUndefined();

    expect(agent.readSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION, messageLimit: 2 }),
    );
    expect(agent.readSessionMessages).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION, limit: 3 }),
    );
    expect(agent.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION }),
    );
    expect(agent.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION }),
    );
  });

  it("keeps unimplemented session methods unavailable", async () => {
    const service = createZcodeSessionService(fakeAgent());

    await expect(
      service.readWorkspacePresentation({ workspacePath: WORKSPACE }),
    ).rejects.toThrow(ZCODE_UNAVAILABLE_PREFIX);
    await expect(
      service.setThoughtLevel({
        workspacePath: WORKSPACE,
        sessionId: SESSION,
        thoughtLevel: "high",
      }),
    ).rejects.toThrow(ZCODE_UNAVAILABLE_PREFIX);
    await expect(
      service.readSessionEvents({
        workspacePath: WORKSPACE,
        sessionId: SESSION,
      }),
    ).rejects.toThrow(ZCODE_UNAVAILABLE_PREFIX);
  });
});
