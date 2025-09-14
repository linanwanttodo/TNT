import type { ChatHistoryItem } from "core";
import { describe, expect, it, vi } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import type {
  ToolCallRequest,
  ToolPermissionPolicy,
} from "../permissions/types.js";
import type { ModelServiceState } from "../services/types.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";

import { VERIFICATION_AGENT } from "./builtInAgents.js";
import { executeSubAgent } from "./executor.js";
import type { AgentRunContext } from "./runContext.js";

vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: vi.fn(async (chatHistory: ChatHistoryItem[]) => {
    chatHistory.push({
      message: { role: "assistant", content: "checked\nVERDICT: PASS" },
      contextItems: [],
    });
    return "checked";
  }),
}));

vi.mock("../hooks/fireHook.js", () => ({
  fireSubagentStart: vi.fn(async () => ({ blocked: false, results: [] })),
  fireSubagentStop: vi.fn(async () => ({ blocked: false, results: [] })),
}));

vi.mock("../session/index.js", () => ({
  getCurrentSession: vi.fn(() => ({ sessionId: "parent", history: [] })),
  saveSubagentSession: vi.fn(),
}));

vi.mock("../utils/cli.js", () => ({
  escapeEvents: { on: vi.fn(), removeListener: vi.fn() },
}));

vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../services/index.js", () => ({
  services: {
    systemMessage: { getSystemMessage: vi.fn(async () => "base prompt") },
    toolPermissions: {
      getState: vi.fn(() => ({
        currentMode: "agent",
        permissions: { policies: [{ tool: "*", permission: "allow" }] },
      })),
    },
  },
}));

function call(name: string): ToolCallRequest {
  return { name, arguments: {} };
}

function parentContext(): AgentRunContext {
  return {
    id: "parent",
    parentContext: undefined,
    delegationDepth: 0,
    systemMessage: "base prompt",
    permissions: { policies: [{ tool: "*", permission: "allow" }] },
    mode: "agent",
    abortSignal: new AbortController().signal,
  };
}

type ChildRun = {
  permissions: { policies: ToolPermissionPolicy[] };
  systemMessage: string;
};

async function runAs(agentName: string): Promise<ChildRun> {
  const agent = {
    model: {
      name: agentName,
      chatOptions: { baseSystemMessage: "do the work" },
    },
    llmApi: {},
  } as unknown as ModelServiceState;

  await executeSubAgent({
    agent,
    prompt: "verify the parser change",
    parentSessionId: "parent",
    parentContext: parentContext(),
    abortController: new AbortController(),
  });

  const lastCall = vi.mocked(streamChatResponse).mock.calls.at(-1)?.[7];
  if (!lastCall) {
    throw new Error("the delegated run never reached the engine");
  }
  return lastCall as unknown as ChildRun;
}

/**
 * The built-in role declares its own limits, and the child context is the only
 * place permissions are narrowed, so this is where the declaration has to land.
 */
describe("built-in agent restriction", () => {
  it("keeps the shell and drops file writes for the verifier", async () => {
    const overrides = await runAs(VERIFICATION_AGENT.name);

    expect(
      checkToolPermission(call("Bash"), overrides.permissions).permission,
    ).toBe("allow");
    expect(
      checkToolPermission(call("Write"), overrides.permissions).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission(call("Edit"), overrides.permissions).permission,
    ).toBe("exclude");
  });

  it("tells the child what it lost", async () => {
    const overrides = await runAs(VERIFICATION_AGENT.name);

    expect(overrides.systemMessage).toContain("base prompt");
    expect(overrides.systemMessage).toContain("cannot create or modify files");
  });

  it("leaves a configured agent as unrestricted as its session", async () => {
    const overrides = await runAs("code-explorer");

    expect(
      checkToolPermission(call("Write"), overrides.permissions).permission,
    ).toBe("allow");
    expect(overrides.systemMessage).not.toContain("restricted tool set");
  });
});
