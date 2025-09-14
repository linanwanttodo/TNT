import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { ChatHistoryItem } from "core/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLEARED_TOOL_RESULT_CONTENT,
  DEFAULT_CACHE_GAP_MS,
  cacheGapMs,
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
      CONTINUE_GLOBAL_DIR: process.env.CONTINUE_GLOBAL_DIR,
      CONTINUE_CLI_TEST_SESSION_ID: process.env.CONTINUE_CLI_TEST_SESSION_ID,
      CONTINUE_CLI_CACHE_GAP_MS: process.env.CONTINUE_CLI_CACHE_GAP_MS,
    };
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-gap-"));
    process.env.CONTINUE_GLOBAL_DIR = globalDir;
    process.env.CONTINUE_CLI_TEST_SESSION_ID = "gap-session";
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
    delete process.env.CONTINUE_CLI_CACHE_GAP_MS;
    expect(cacheGapMs()).toBe(DEFAULT_CACHE_GAP_MS);
    expect(DEFAULT_CACHE_GAP_MS).toBe(5 * 60 * 1000);

    process.env.CONTINUE_CLI_CACHE_GAP_MS = "1000";
    expect(cacheGapMs()).toBe(1000);
  });

  it("measures a resumed session from the session file's own timestamp", async () => {
    const { getSessionFilePath } = await import("../session/index.js");
    process.env.CONTINUE_CLI_CACHE_GAP_MS = "1000";
    fs.writeFileSync(getSessionFilePath(), "{}", "utf-8");
    const written = Date.now();
    fs.utimesSync(
      getSessionFilePath(),
      new Date(written - 5000),
      new Date(written - 5000),
    );

    expect(isCacheCold(written)).toBe(true);
    expect(isCacheCold(written - 5000 + 500)).toBe(false);
  });

  it("prefers this process's own last request once one has been sent", async () => {
    const { getSessionFilePath } = await import("../session/index.js");
    process.env.CONTINUE_CLI_CACHE_GAP_MS = "1000";
    fs.writeFileSync(getSessionFilePath(), "{}", "utf-8");
    fs.utimesSync(getSessionFilePath(), new Date(0), new Date(0));

    const sent = Date.now();
    noteRequestSent(sent);

    expect(isCacheCold(sent + 100)).toBe(false);
    expect(isCacheCold(sent + 5000)).toBe(true);
  });
});
