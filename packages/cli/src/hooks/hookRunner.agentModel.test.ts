import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  subagentAgent: undefined as unknown,
  completion: undefined as unknown,
  warns: [] as string[],
}));

const sessionState = vi.hoisted(() => ({
  llmApi: { id: "session-api" },
  model: { name: "session-model", model: "gpt-x" },
  assistant: { models: [] },
  authConfig: null,
}));

vi.mock("../services/index.js", () => ({
  services: { model: { isReady: () => true } },
  serviceContainer: { get: async () => sessionState },
  SERVICE_NAMES: { MODEL: "model" },
}));

vi.mock("../services/ModelService.js", () => ({
  ModelService: {
    findModelByName: (_state: unknown, name: string) =>
      name === "cheap-model"
        ? {
            llmApi: { id: "cheap-api" },
            model: { name: "cheap-model", model: "haiku" },
            assistant: { models: [] },
            authConfig: null,
          }
        : null,
  },
}));

vi.mock("../subagent/executor.js", () => ({
  executeSubAgent: vi.fn(async ({ agent }: any) => {
    captured.subagentAgent = agent;
    return { success: true, response: '{"decision":"allow"}' };
  }),
}));

vi.mock("../utils/exponentialBackoff.js", () => ({
  chatCompletionStreamWithBackoff: vi.fn(async (llmApi: any, request: any) => {
    captured.completion = { llmApiId: llmApi?.id, model: request.model };
    return {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: '{"decision":"allow"}' } }] };
      },
    };
  }),
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: (message: string) => captured.warns.push(message),
  },
}));

import { runHooks } from "./hookRunner.js";
import type {
  AgentHookHandler,
  HookHandler,
  HooksConfig,
  PreToolUseInput,
} from "./types.js";

function input(): PreToolUseInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: process.cwd(),
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_use_id: "tool-1",
  };
}

function agentHook(handler: Partial<AgentHookHandler>): HooksConfig {
  return {
    PreToolUse: [
      {
        matcher: "*",
        hooks: [
          {
            type: "agent",
            prompt: "verify $ARGUMENTS",
            ...handler,
          } as AgentHookHandler,
        ],
      },
    ],
  };
}

beforeEach(() => {
  captured.subagentAgent = undefined;
  captured.completion = undefined;
  captured.warns.length = 0;
});

/**
 * `model` is in the handler contract for both LLM-backed hook types, and the
 * agent path is where it matters most: an adversarial check on the wrong model
 * is a different cost and a different quality of result.
 */
describe("agent hook model selection", () => {
  it("runs on the model the hook named", async () => {
    await runHooks(agentHook({ model: "cheap-model" }), input(), process.cwd());

    expect((captured.subagentAgent as any).model.name).toBe("cheap-model");
  });

  it("falls back to the session model and says so", async () => {
    await runHooks(
      agentHook({ model: "not-configured" }),
      input(),
      process.cwd(),
    );

    expect((captured.subagentAgent as any).model.name).toBe("session-model");
    expect(captured.warns.join("\n")).toContain("model not found");
  });

  it("uses the session model when the hook names none", async () => {
    await runHooks(agentHook({}), input(), process.cwd());

    expect((captured.subagentAgent as any).model.name).toBe("session-model");
    expect(captured.warns).toEqual([]);
  });

  it("runs a prompt hook on the named entry's api and keeps the requested id on the wire", async () => {
    await runHooks(
      {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "prompt",
                prompt: "check $ARGUMENTS",
                model: "cheap-model",
              } as HookHandler,
            ],
          },
        ],
      },
      input(),
      process.cwd(),
    );

    // The entry decides credentials and endpoint; the string the author wrote
    // still goes out as the model id, so a raw id at a gateway keeps working.
    expect(captured.completion).toEqual({
      llmApiId: "cheap-api",
      model: "cheap-model",
    });
  });
});
