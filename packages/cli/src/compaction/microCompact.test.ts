import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { ChatHistoryItem } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLEARED_TOOL_RESULT_CONTENT,
  DEFAULT_CACHE_GAP_MS,
  LONG_LIVED_CACHE_GAP_MS,
  cacheGapMs,
  defaultCacheGapMs,
  forgetLastRequest,
  isCacheCold,
  microCompactHistory,
  noteRequestSent,
  shouldMicroCompact,
} from "./microCompact.js";

const item = (message: Record<string, unknown>): ChatHistoryItem =>
  ({ message }) as unknown as ChatHistoryItem;

const toolResult = (id: string, text: string) =>
  item({ role: "tool", tool_call_id: id, content: text });
const assistant = (text: string) => item({ role: "assistant", content: text });
const user = (text: string) => item({ role: "user", content: text });

describe("shouldMicroCompact", () => {
  it("needs a known last activity, so a first run never fires", () => {
    expect(
      shouldMicroCompact({
        now: 1_000_000,
        lastActivity: undefined,
        gapMs: 1000,
      }),
    ).toBe(false);
  });

  it("fires at the gap and not a millisecond before", () => {
    expect(
      shouldMicroCompact({ now: 1000, lastActivity: 0, gapMs: 1000 }),
    ).toBe(true);
    expect(shouldMicroCompact({ now: 999, lastActivity: 0, gapMs: 1000 })).toBe(
      false,
    );
  });
});

describe("microCompactHistory", () => {
  const twoTurns = () => [
    user("first question"),
    assistant("calling a tool"),
    toolResult("call_1", "x".repeat(4000)),
    toolResult("call_2", "y".repeat(2000)),
    assistant("the answer"),
    user("second question"),
    assistant("working on it"),
  ];

  it("clears old tool results and keeps the call pairing", () => {
    const { history, clearedResults, droppedChars } =
      microCompactHistory(twoTurns());

    expect(clearedResults).toBe(2);
    expect(droppedChars).toBeGreaterThan(5000);
    expect(history[2].message).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: CLEARED_TOOL_RESULT_CONTENT,
    });
    expect(history[2]).toHaveProperty("message.tool_call_id", "call_1");
  });

  it("leaves the last turn alone, because that is what the request is about", () => {
    const history = [
      user("first question"),
      toolResult("call_1", "x".repeat(1000)),
      user("second question"),
      toolResult("call_2", "y".repeat(1000)),
      assistant("the current answer so far"),
    ];

    const { history: compacted } = microCompactHistory(history);

    expect(compacted[3].message.content).toBe("y".repeat(1000));
    expect(compacted[1].message.content).toBe(CLEARED_TOOL_RESULT_CONTENT);
  });

  it("keeps at least one message: a single-turn history is untouched", () => {
    const history = [
      user("only question"),
      toolResult("call_1", "z".repeat(500)),
    ];

    const { history: compacted, clearedResults } = microCompactHistory(history);

    expect(clearedResults).toBe(0);
    expect(compacted).toBe(history);
    expect(compacted[1].message.content).toBe("z".repeat(500));
  });

  it("never clears assistant or user text, only tool results", () => {
    const long = "a".repeat(3000);
    const { history: compacted } = microCompactHistory([
      user("ask"),
      assistant(long),
      toolResult("call_1", long),
      user("again"),
    ]);

    expect((compacted[1].message as { content: string }).content).toBe(long);
    expect((compacted[2].message as { content: string }).content).toBe(
      CLEARED_TOOL_RESULT_CONTENT,
    );
  });

  it("drops an array tool result down to the marker, images with it", () => {
    const { history: compacted } = microCompactHistory([
      user("look at this"),
      item({
        role: "tool",
        tool_call_id: "call_9",
        content: [
          { type: "text", text: "a screenshot arrived" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAAA" },
          },
        ],
      }),
      user("next"),
    ]);

    expect((compacted[1].message as { content: unknown }).content).toBe(
      CLEARED_TOOL_RESULT_CONTENT,
    );
  });

  it("refuses to touch a result with no call to pair it with", () => {
    const orphan = toolResult("", "k".repeat(900));
    delete (orphan.message as { tool_call_id?: unknown }).tool_call_id;

    const { clearedResults, history: compacted } = microCompactHistory([
      user("ask"),
      orphan,
      user("again"),
    ]);

    expect(clearedResults).toBe(0);
    expect((compacted[1].message as { content: string }).content).toBe(
      "k".repeat(900),
    );
  });
});

describe("the gap itself", () => {
  let globalDir = "";
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = {
      TNT_GLOBAL_DIR: process.env.TNT_GLOBAL_DIR,
      TNT_TEST_SESSION_ID: process.env.TNT_TEST_SESSION_ID,
      TNT_CACHE_GAP_MS: process.env.TNT_CACHE_GAP_MS,
      TNT_CACHE_RETENTION: process.env.TNT_CACHE_RETENTION,
    };
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-gap-"));
    process.env.TNT_GLOBAL_DIR = globalDir;
    process.env.TNT_TEST_SESSION_ID = "gap-session";
    forgetLastRequest();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    forgetLastRequest();
    fs.rmSync(globalDir, { recursive: true, force: true });
  });

  it("defaults to the five minutes a provider caches for", () => {
    delete process.env.TNT_CACHE_GAP_MS;
    expect(cacheGapMs()).toBe(DEFAULT_CACHE_GAP_MS);
    expect(DEFAULT_CACHE_GAP_MS).toBe(5 * 60 * 1000);

    process.env.TNT_CACHE_GAP_MS = "1000";
    expect(cacheGapMs()).toBe(1000);
  });

  it("measures a resumed session from the session file's own timestamp", async () => {
    const { getSessionFilePath } = await import("../session/index.js");
    process.env.TNT_CACHE_GAP_MS = "1000";
    const sessionFile = getSessionFilePath();
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "{}", "utf-8");
    const written = Date.now();
    fs.utimesSync(
      sessionFile,
      new Date(written - 5000),
      new Date(written - 5000),
    );

    expect(isCacheCold(written)).toBe(true);
    expect(isCacheCold(written - 5000 + 500)).toBe(false);
  });

  it("takes the gap from each provider's own cache lifetime", () => {
    delete process.env.TNT_CACHE_GAP_MS;
    delete process.env.TNT_CACHE_RETENTION;

    expect(defaultCacheGapMs("deepseek", "deepseek-reasoner")).toBe(
      LONG_LIVED_CACHE_GAP_MS,
    );
    expect(LONG_LIVED_CACHE_GAP_MS).toBe(24 * 60 * 60 * 1000);
    expect(cacheGapMs("deepseek")).toBe(LONG_LIVED_CACHE_GAP_MS);
    expect(cacheGapMs("anthropic", "claude-sonnet")).toBe(DEFAULT_CACHE_GAP_MS);
    expect(cacheGapMs("moonshot", "kimi-k3")).toBe(DEFAULT_CACHE_GAP_MS);
    expect(cacheGapMs("gemini", "gemini-4-pro")).toBe(DEFAULT_CACHE_GAP_MS);

    // Providers with their own retention windows use them, not five minutes.
    expect(cacheGapMs("openai", "gpt-4")).toBe(30 * 60 * 1000);
    expect(cacheGapMs("openai", "gpt-5.6-sol")).toBe(30 * 60 * 1000);

    // A provider with no prompt cache has nothing to lose by keeping history.
    expect(cacheGapMs("ollama", "llama3")).toBe(Number.POSITIVE_INFINITY);

    // Long retention selects the provider's longer window.
    process.env.TNT_CACHE_RETENTION = "long";
    expect(cacheGapMs("anthropic", "claude-sonnet")).toBe(60 * 60 * 1000);
    expect(cacheGapMs("openai", "gpt-5.6-sol")).toBe(12 * 60 * 60 * 1000);
    expect(cacheGapMs("deepseek")).toBe(LONG_LIVED_CACHE_GAP_MS);

    // An explicit override still wins over the provider default.
    process.env.TNT_CACHE_GAP_MS = "1000";
    expect(cacheGapMs("deepseek")).toBe(1000);
  });

  it("does not prune a long-lived cache after six idle minutes", () => {
    delete process.env.TNT_CACHE_GAP_MS;
    const now = Date.now();
    noteRequestSent(now - 6 * 60 * 1000);

    expect(isCacheCold(now, "deepseek", "deepseek-chat")).toBe(false);
    expect(isCacheCold(now, "anthropic", "claude-sonnet")).toBe(true);
  });

  it("prefers this process's own last request once one has been sent", async () => {
    const { getSessionFilePath } = await import("../session/index.js");
    process.env.TNT_CACHE_GAP_MS = "1000";
    const sessionFile = getSessionFilePath();
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "{}", "utf-8");
    fs.utimesSync(sessionFile, new Date(0), new Date(0));

    const sent = Date.now();
    noteRequestSent(sent);

    expect(isCacheCold(sent + 100)).toBe(false);
    expect(isCacheCold(sent + 5000)).toBe(true);
  });
});
