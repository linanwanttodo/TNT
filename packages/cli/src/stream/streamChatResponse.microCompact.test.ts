import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { ChatHistoryItem } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastRequest } from "../compaction/microCompact.js";

import { handlePreApiCompaction } from "./streamChatResponse.compactionHelpers.js";

vi.mock("./streamChatResponse.autoCompaction.js", () => ({
  // Nothing token-shaped is over the limit here; the only reduction under test is
  // the one a cold cache triggers.
  handleAutoCompaction: vi.fn(async (history: ChatHistoryItem[]) => ({
    wasCompacted: false,
    chatHistory: history,
  })),
}));

const item = (message: Record<string, unknown>): ChatHistoryItem =>
  ({ message }) as unknown as ChatHistoryItem;

const longResult = (id: string, size: number) =>
  item({ role: "tool", tool_call_id: id, content: "x".repeat(size) });

/**
 * A request that arrives after the provider's cache has expired is paying full
 * price for results nobody will read again, so the shrink has to happen on the
 * request path rather than in a helper only the tests call.
 */
describe("a cold cache shrinks the history before the request", () => {
  let globalDir = "";
  const model = {
    provider: "anthropic",
    name: "test-model",
    model: "test-model",
    defaultCompletionOptions: { contextLength: 200_000, maxTokens: 4096 },
  } as any;

  beforeEach(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-micro-"));
    process.env.CONTINUE_GLOBAL_DIR = globalDir;
    process.env.CONTINUE_CLI_TEST_SESSION_ID = "micro-session";
    process.env.CONTINUE_CLI_CACHE_GAP_MS = "1";
    forgetLastRequest();
  });

  afterEach(() => {
    for (const key of [
      "CONTINUE_GLOBAL_DIR",
      "CONTINUE_CLI_TEST_SESSION_ID",
      "CONTINUE_CLI_CACHE_GAP_MS",
    ]) {
      delete process.env[key];
    }
    forgetLastRequest();
    fs.rmSync(globalDir, { recursive: true, force: true });
  });

  const history = (): ChatHistoryItem[] => [
    item({ role: "user", content: "first question" }),
    longResult("call_1", 5000),
    item({ role: "assistant", content: "an answer" }),
    item({ role: "user", content: "second question" }),
    longResult("call_2", 5000),
  ];

  it("clears the earlier turn and keeps the current one", async () => {
    const sessionFile = path.join(globalDir, "sessions", "micro-session.json");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "{}", "utf-8");
    fs.utimesSync(
      sessionFile,
      new Date(Date.now() - 60_000),
      new Date(Date.now() - 60_000),
    );

    const { chatHistory: after, wasCompacted } = await handlePreApiCompaction(
      history(),
      {
        model,
        llmApi: {} as any,
        isCompacting: false,
        isHeadless: true,
        systemMessage: "system",
        tools: [],
      },
    );

    expect(wasCompacted).toBe(false);
    expect((after[1].message as { content: string }).content).toBe(
      "[Old tool result content cleared]",
    );
    expect((after[4].message as { content: string }).content).toBe(
      "x".repeat(5000),
    );
  });

  it("leaves a warm history exactly as it was", async () => {
    // No session file and no request sent yet: there is nothing to measure the gap
    // from, so the history must come back untouched rather than guessed at.
    const before = history();
    const { chatHistory: after } = await handlePreApiCompaction(before, {
      model,
      llmApi: {} as any,
      isCompacting: false,
      isHeadless: true,
      systemMessage: "system",
      tools: [],
    });

    expect(after).toEqual(before);
  });
});
