import fs from "fs";
import os from "os";
import path from "path";

import type { ChatHistoryItem, Session, ToolCall } from "core/index.js";
import { convertFromUnifiedHistoryWithSystemMessage } from "core/util/messageConversion.js";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { historyAdapter } from "./historyAdapter.js";
import { createSession, resumeSession } from "./index.js";
import {
  INTERRUPTED_TOOL_RESULT_CONTENT,
  repairDanglingToolCalls,
} from "./repairDanglingToolCalls.js";
import { sessionStore } from "./store.js";

let previousGlobalDir: string | undefined;
let testRoot: string;

function userItem(text: string): ChatHistoryItem {
  return {
    message: { role: "user", content: text },
    contextItems: [],
  } as ChatHistoryItem;
}

function toolCall(id: string, name: string, args: string): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

function assistantWithCalls(
  text: string,
  calls: ToolCall[],
  states?: any[],
): ChatHistoryItem {
  return {
    message: {
      role: "assistant",
      content: text,
      toolCalls: calls.map((tc) => ({
        id: tc.id,
        type: tc.type,
        function: { ...tc.function },
      })),
    },
    contextItems: [],
    ...(states && { toolCallStates: states }),
  } as ChatHistoryItem;
}

/** The provider-facing projection processStreamingResponse sends. */
function requestMessages(history: ChatHistoryItem[]) {
  return convertFromUnifiedHistoryWithSystemMessage(history, "system prompt");
}

/** Pairs every tool_call with the tool result that answers it. */
function collectToolTraffic(messages: any[]) {
  const calls: Array<{ id: string; index: number }> = [];
  const results: Array<{ id: string; index: number; content: string }> = [];
  messages.forEach((message, index) => {
    for (const call of message.tool_calls ?? []) {
      calls.push({ id: call.id, index });
    }
    if (message.role === "tool") {
      results.push({
        id: message.tool_call_id,
        index,
        content: message.content,
      });
    }
  });
  return { calls, results };
}

function danglingOnly(calls: any[], results: any[]): string[] {
  // A call is unanswered when no tool result with its id follows it.
  return calls
    .filter(
      (call) =>
        !results.some(
          (result) => result.id === call.id && result.index > call.index,
        ),
    )
    .map((call) => call.id);
}

function makeSession(history: ChatHistoryItem[]): Session {
  return {
    sessionId: randomUUID(),
    title: "Test Session",
    workspaceDirectory: process.cwd(),
    history,
    usage: {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      promptTokensDetails: {
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    },
  };
}

beforeEach(() => {
  previousGlobalDir = process.env.TNT_GLOBAL_DIR;
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-session-repair-"));
  process.env.TNT_GLOBAL_DIR = testRoot;
  sessionStore.clearAll();
});

afterEach(() => {
  sessionStore.releaseAll();
  fs.rmSync(testRoot, { recursive: true, force: true });
  if (previousGlobalDir === undefined) delete process.env.TNT_GLOBAL_DIR;
  else process.env.TNT_GLOBAL_DIR = previousGlobalDir;
});

/**
 * The projection at core/util/messageConversion.ts:92-114 turns
 * `assistant.toolCalls` into provider `tool_calls` verbatim, and
 * convertFromUnifiedHistory emits one tool message per toolCallState - so
 * pairing after a repair is judged on exactly what the provider would see.
 */
describe("repairDanglingToolCalls against the messageConversion projection", () => {
  it("answers a call without a result so tool_calls and tool messages pair up", () => {
    const history = [
      userItem("run the checks"),
      // The call was streamed but the process died before any result: the
      // assistant item carries no toolCallStates at all.
      assistantWithCalls("running", [
        toolCall("call_1", "Bash", '{"command":"npm test"'),
      ]),
    ];

    const repaired = repairDanglingToolCalls(history);
    const { calls, results } = collectToolTraffic(requestMessages(repaired));

    expect(calls.map((call) => call.id)).toEqual(["call_1"]);
    expect(results.map((result) => result.id)).toEqual(["call_1"]);
    expect(danglingOnly(calls, results)).toEqual([]);
    expect(results[0].content).toBe(INTERRUPTED_TOOL_RESULT_CONTENT);

    // The declared call keeps its name and the accumulated arguments text.
    const assistant = repaired[1].message as any;
    expect(assistant.toolCalls[0].function.name).toBe("Bash");
    expect(assistant.toolCalls[0].function.arguments).toBe(
      '{"command":"npm test"',
    );
    expect(repaired[1].toolCallStates?.[0].status).toBe("errored");
  });

  it("leaves an already paired assistant item untouched", () => {
    const paired = assistantWithCalls(
      "done",
      [toolCall("call_2", "Read", '{"filepath":"src/a.ts"}')],
      [
        {
          toolCallId: "call_2",
          toolCall: toolCall("call_2", "Read", '{"filepath":"src/a.ts"}'),
          status: "done",
          parsedArgs: { filepath: "src/a.ts" },
          output: [
            {
              content: "file body",
              name: "Tool Result: Read",
              description: "Tool execution result",
            },
          ],
        },
      ],
    );
    const history = [userItem("read it"), paired];

    const repaired = repairDanglingToolCalls(history);

    expect(repaired[1]).toBe(history[1]);
    const { calls, results } = collectToolTraffic(requestMessages(repaired));
    expect(danglingOnly(calls, results)).toEqual([]);
    expect(results[0].content).toBe("file body");
  });

  it("repairs a state that exists but never received its output", () => {
    const crashed = assistantWithCalls(
      "cleaning",
      [toolCall("call_3", "Bash", '{"command":"rm -rf dist"}')],
      [
        {
          toolCallId: "call_3",
          toolCall: toolCall("call_3", "Bash", '{"command":"rm -rf dist"}'),
          status: "calling",
          parsedArgs: { command: "rm -rf dist" },
        },
      ],
    );
    const history = [userItem("clean"), crashed];

    const repaired = repairDanglingToolCalls(history);

    const state = repaired[1].toolCallStates?.[0];
    expect(state?.status).toBe("errored");
    expect(state?.output?.[0].content).toBe(INTERRUPTED_TOOL_RESULT_CONTENT);
    // The call's own record is preserved, not regenerated.
    expect(state?.toolCall).toEqual(crashed.toolCallStates?.[0].toolCall);
    const { calls, results } = collectToolTraffic(requestMessages(repaired));
    expect(danglingOnly(calls, results)).toEqual([]);
  });

  it("returns the same array when nothing dangles", () => {
    const history = [userItem("hello"), assistantWithCalls("hi", [])];
    expect(repairDanglingToolCalls(history)).toBe(history);
  });

  it("is idempotent", () => {
    const history = [
      userItem("run"),
      assistantWithCalls("running", [
        toolCall("call_4", "Bash", '{"command":"ls"'),
      ]),
    ];
    const once = repairDanglingToolCalls(history);
    const twice = repairDanglingToolCalls(once);
    expect(twice).toEqual(once);
    expect(twice[1]).toBe(once[1]);
  });
});

/**
 * Acceptance ②: a kill between writing the assistant message and writing its
 * result leaves a dangling tool_calls in the transcript. The resumed session
 * must not replay it - the first provider request answers every call.
 */
describe("resume repairs a transcript killed mid-tool-call", () => {
  function persist(sessionId: string, history: ChatHistoryItem[]): void {
    const created = createSession(history, sessionId);
    historyAdapter.save(created);
  }

  function killLosingStates(sessionId: string): void {
    // The assistant message reached the transcript with its tool call, but
    // the per-call state (and with it any result) never did - the shape the
    // provider sees as an unanswered tool_calls.
    persist(sessionId, [
      userItem("clean the build"),
      assistantWithCalls("cleaning", [
        toolCall("call_kill", "Bash", '{"command":"rm -rf dist"}'),
      ]),
    ]);
  }

  it("sends no unanswered tool_calls in the first resumed request", () => {
    const sessionId = randomUUID();
    killLosingStates(sessionId);

    // The raw transcript on disk is the broken shape: the unrepaired
    // projection leaves the call unanswered, which is what the provider
    // refused before the fix.
    const raw = historyAdapter.load(sessionId);
    const rawTraffic = collectToolTraffic(requestMessages(raw.history));
    expect(danglingOnly(rawTraffic.calls, rawTraffic.results)).toEqual([
      "call_kill",
    ]);

    const resumed = resumeSession(sessionId);
    expect(resumed).not.toBeNull();

    const traffic = collectToolTraffic(requestMessages(resumed!.history));
    expect(traffic.calls.map((call) => call.id)).toEqual(["call_kill"]);
    expect(danglingOnly(traffic.calls, traffic.results)).toEqual([]);
    expect(traffic.results[0].content).toBe(INTERRUPTED_TOOL_RESULT_CONTENT);

    // The kept parts of the transcript are untouched.
    expect(resumed!.history[0].message).toEqual(raw.history[0].message);
    const callState = resumed!.history[1].toolCallStates?.[0];
    expect(callState?.toolCall.function.arguments).toBe(
      '{"command":"rm -rf dist"}',
    );
    expect(callState?.status).toBe("errored");
  });

  it("upgrades a killed call whose state survived without an output", () => {
    const sessionId = randomUUID();
    persist(sessionId, [
      userItem("clean the build"),
      assistantWithCalls(
        "cleaning",
        [toolCall("call_stuck", "Bash", '{"command":"rm -rf dist"}')],
        [
          {
            toolCallId: "call_stuck",
            toolCall: toolCall(
              "call_stuck",
              "Bash",
              '{"command":"rm -rf dist"}',
            ),
            status: "calling",
            parsedArgs: { command: "rm -rf dist" },
          },
        ],
      ),
    ]);

    const resumed = resumeSession(sessionId);
    expect(resumed).not.toBeNull();
    const callState = resumed!.history[1].toolCallStates?.[0];
    expect(callState?.status).toBe("errored");
    expect(callState?.output?.[0].content).toBe(
      INTERRUPTED_TOOL_RESULT_CONTENT,
    );
    // The projection now answers the call with the placeholder instead of the
    // generic "Tool cancelled" fallback.
    const traffic = collectToolTraffic(requestMessages(resumed!.history));
    expect(danglingOnly(traffic.calls, traffic.results)).toEqual([]);
    expect(traffic.results[0].content).toBe(INTERRUPTED_TOOL_RESULT_CONTENT);
  });

  it("does not disturb a session whose transcript is already paired", () => {
    const sessionId = randomUUID();
    const session = makeSession([
      userItem("read it"),
      assistantWithCalls(
        "done",
        [toolCall("call_ok", "Read", '{"filepath":"src/a.ts"}')],
        [
          {
            toolCallId: "call_ok",
            toolCall: toolCall("call_ok", "Read", '{"filepath":"src/a.ts"}'),
            status: "done",
            parsedArgs: { filepath: "src/a.ts" },
            output: [
              {
                content: "file body",
                name: "Tool Result: Read",
                description: "Tool execution result",
              },
            ],
          },
        ],
      ),
    ]);
    session.sessionId = sessionId;
    const created = createSession(session.history, sessionId);
    historyAdapter.save(created);

    const resumed = resumeSession(sessionId);
    expect(resumed).not.toBeNull();
    expect(resumed!.history[1].toolCallStates?.[0].output?.[0].content).toBe(
      "file body",
    );
    const traffic = collectToolTraffic(requestMessages(resumed!.history));
    expect(danglingOnly(traffic.calls, traffic.results)).toEqual([]);
  });
});
