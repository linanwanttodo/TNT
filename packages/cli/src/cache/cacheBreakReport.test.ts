import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CACHE_MISS_NOISE_FLOOR_TOKENS,
  assessCacheBreak,
  cacheHitRate,
  describePrefixDiff,
  forgetCacheRound,
  forgetCacheRounds,
  recordCacheRound,
  recallCacheRound,
  writeCacheBreakReport,
} from "./cacheBreakReport.js";
import type { RequestHeader } from "./requestHeader.js";

const header = (over: Partial<RequestHeader> = {}): RequestHeader => ({
  model: "test-model",
  systemMessage: "line one\nline two\nline three",
  tools: [
    {
      type: "function",
      function: { name: "Read", description: "read", parameters: {} },
    },
    {
      type: "function",
      function: { name: "Bash", description: "run", parameters: {} },
    },
  ],
  ...over,
});

describe("cacheHitRate", () => {
  it("reads the share of the prompt the provider already had", () => {
    expect(cacheHitRate({ inputTokens: 1000, cacheReadTokens: 250 })).toBe(
      0.25,
    );
    expect(cacheHitRate({ inputTokens: 0, cacheReadTokens: 0 })).toBe(0);
    // A provider that reports more read than sent is a rounding difference, not
    // a ratio above one.
    expect(cacheHitRate({ inputTokens: 100, cacheReadTokens: 140 })).toBe(1);
  });
});

describe("assessCacheBreak", () => {
  // A round that read its whole prompt back from the cache.
  const warm = {
    inputTokens: 100_000,
    cacheReadTokens: 100_000,
    reportedCache: true,
  };
  const cold = { inputTokens: 9_000, cacheReadTokens: 2_700 };

  it("needs a previous round to call anything a miss", () => {
    expect(assessCacheBreak(undefined, cold).report).toBe(false);
    expect(assessCacheBreak(undefined, cold).missedTokens).toBe(0);
  });

  it("does not count a growing prompt as a miss", () => {
    // The new turn's tokens were never in the previous request, so only the
    // overlapping head is expected from the cache.
    const assessment = assessCacheBreak(warm, {
      inputTokens: 120_000,
      cacheReadTokens: 100_000,
    });

    expect(assessment.missedTokens).toBe(0);
    expect(assessment.report).toBe(false);
  });

  it("keeps a miss inside the noise floor quiet", () => {
    const atFloor = assessCacheBreak(warm, {
      inputTokens: 100_000,
      cacheReadTokens: 100_000 - CACHE_MISS_NOISE_FLOOR_TOKENS,
    });
    expect(atFloor.missedTokens).toBe(CACHE_MISS_NOISE_FLOOR_TOKENS);
    expect(atFloor.report).toBe(false);

    const aboveFloor = assessCacheBreak(warm, {
      inputTokens: 100_000,
      cacheReadTokens: 100_000 - CACHE_MISS_NOISE_FLOOR_TOKENS - 1,
    });
    expect(aboveFloor.report).toBe(true);
  });

  it("calls a full miss a break and keeps the display rates", () => {
    const assessment = assessCacheBreak(warm, {
      inputTokens: 100_000,
      cacheReadTokens: 0,
    });

    expect(assessment.report).toBe(true);
    expect(assessment.missedTokens).toBe(100_000);
    expect(assessment.previousRate).toBeCloseTo(1, 4);
    expect(assessment.currentRate).toBe(0);
    expect(assessment.dropPoints).toBeCloseTo(100, 1);
  });

  it("does not judge a provider that never reported cache activity", () => {
    expect(
      assessCacheBreak(
        { inputTokens: 9_000, cacheReadTokens: 0, reportedCache: false },
        { inputTokens: 9_000, cacheReadTokens: 0 },
      ).report,
    ).toBe(false);

    // A direct caller without the sticky field: the previous round itself
    // reported nothing, so there is no evidence the provider has a cache.
    expect(
      assessCacheBreak(
        { inputTokens: 9_000, cacheReadTokens: 0 },
        { inputTokens: 9_000, cacheReadTokens: 0 },
      ).report,
    ).toBe(false);
  });

  it("judges a total miss after earlier activity", () => {
    expect(
      assessCacheBreak(
        { inputTokens: 9_000, cacheReadTokens: 0, reportedCache: true },
        { inputTokens: 9_000, cacheReadTokens: 0 },
      ).report,
    ).toBe(true);
  });

  it("remembers the round for the key it was given, and keeps activity sticky", () => {
    forgetCacheRounds();
    expect(recallCacheRound("a")).toBeUndefined();

    recordCacheRound("a", { inputTokens: 1_000, cacheReadTokens: 500 });
    recordCacheRound("b", { inputTokens: 1_000, cacheReadTokens: 0 });

    expect(recallCacheRound("a")?.reportedCache).toBe(true);
    expect(recallCacheRound("b")?.reportedCache).toBe(false);

    // A later round that reports nothing does not erase what the session saw.
    recordCacheRound("a", { inputTokens: 1_000, cacheReadTokens: 0 });
    expect(recallCacheRound("a")?.reportedCache).toBe(true);

    forgetCacheRounds();
    expect(recallCacheRound("a")).toBeUndefined();
  });

  it("forgets one key when a context rewrite lands", () => {
    recordCacheRound("a", warm);
    recordCacheRound("b", warm);

    forgetCacheRound("a");

    expect(recallCacheRound("a")).toBeUndefined();
    expect(recallCacheRound("b")).toBeDefined();
    forgetCacheRounds();
  });
});

describe("describePrefixDiff", () => {
  it("records the mode as context for a break that really happened", () => {
    const diff = describePrefixDiff(
      header({ mode: "default" }),
      header({ mode: "plan", systemMessage: "line one\nline two moved" }),
      ["systemMessage"],
    ) as any;

    // The mode is not a reason - it never reaches the provider - but a reader of
    // the break file wants to know the session had switched.
    expect(diff.mode).toEqual({ before: "default", after: "plan" });
  });

  it("names the part of the prefix that moved", () => {
    const withRules = (rules: string) =>
      header({
        systemMessage: `base text\n\n<context name="userRules">\n${rules}\n</context>`,
      });

    const diff = describePrefixDiff(
      withRules("keep the paths short"),
      withRules("keep the paths short and absolute"),
      ["systemMessage"],
    ) as any;

    // The cached prefix is billed from the first byte that differs, so "which
    // part" is the only half of this a user can act on: rules are theirs, the
    // base text is the CLI's.
    expect(diff.systemMessageSections).toBe("userRules rewritten");
  });

  it("shows the lines of the system message that moved", () => {
    const diff = describePrefixDiff(
      header(),
      header({ systemMessage: "line one\nline two changed\nline three" }),
      ["systemMessage"],
    ) as any;

    expect(diff.systemMessage.removed).toEqual(["line two"]);
    expect(diff.systemMessage.added).toEqual(["line two changed"]);
  });

  it("names the tool whose definition moved, and the ones added or dropped", () => {
    const changed = header({
      tools: [
        {
          type: "function",
          function: {
            name: "Read",
            description: "read now more",
            parameters: {},
          },
        },
        {
          type: "function",
          function: { name: "Bash", description: "run", parameters: {} },
        },
        {
          type: "function",
          function: { name: "New", description: "fresh", parameters: {} },
        },
      ],
    });
    const diff = describePrefixDiff(header(), changed, ["tools"]) as any;

    expect(diff.tools.changed).toEqual(["Read"]);
    expect(diff.tools.added).toEqual(["New"]);
    expect(diff.tools.removed).toEqual([]);
    expect(diff.tools.moved).toEqual([]);
  });

  it("reports a swapped tool order as a move, not as a changed definition", () => {
    const swapped = header({
      tools: [
        {
          type: "function",
          function: { name: "Bash", description: "run", parameters: {} },
        },
        {
          type: "function",
          function: { name: "Read", description: "read", parameters: {} },
        },
      ],
    });
    const diff = describePrefixDiff(header(), swapped, ["tools"]) as any;

    expect(diff.tools.changed).toEqual([]);
    expect(diff.tools.moved).toEqual([
      "slot 0: Read -> Bash",
      "slot 1: Bash -> Read",
    ]);
  });

  it("carries the frozen fields and a rewritten history", () => {
    const diff = describePrefixDiff(
      header({ temperature: 0 }),
      header({ temperature: 0.7, model: "other-model" }),
      ["model", "temperature"],
    ) as any;

    expect(diff.model).toEqual({ before: "test-model", after: "other-model" });
    expect(diff.temperature).toEqual({ before: 0, after: 0.7 });
    expect(diff.tools).toBeUndefined();

    const rewritten = describePrefixDiff(header(), header(), [
      "history_rewritten",
    ]) as any;
    expect(rewritten.history).toContain("rewritten");
  });

  it("says nothing about a field that did not move", () => {
    expect(describePrefixDiff(header(), header(), ["model"])).toEqual({});
  });
});

describe("writeCacheBreakReport", () => {
  let globalDir = "";
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = {
      TNT_GLOBAL_DIR: process.env.TNT_GLOBAL_DIR,
      TNT_TEST_SESSION_ID: process.env.TNT_TEST_SESSION_ID,
    };
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-cache-breaks-"));
    process.env.TNT_GLOBAL_DIR = globalDir;
    process.env.TNT_TEST_SESSION_ID = "cache-break-session";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(globalDir, { recursive: true, force: true });
  });

  it("writes the diff beside the session store and hands back the path", () => {
    const previous = header();
    const current = header({
      systemMessage: "line one\nline two became something else\nline three",
    });

    const file = writeCacheBreakReport({
      verdict: { state: "invalidated", reasons: ["systemMessage"] },
      previous,
      current,
      assessment: {
        report: true,
        previousRate: 0.9,
        currentRate: 0.2,
        dropPoints: 70,
        missedTokens: 80_000,
      },
    });

    expect(file).toBeDefined();
    const body = JSON.parse(fs.readFileSync(file as string, "utf-8"));
    expect(body.session).toBe("cache-break-session");
    expect(body.reasons).toEqual(["systemMessage"]);
    expect(body.prefix).toBe("invalidated");
    expect(body.hitRate).toEqual({
      previous: 0.9,
      current: 0.2,
      dropPoints: 70,
    });
    expect(body.missedTokens).toBe(80_000);
    expect(body.diff.systemMessage.added[0]).toContain("became something else");
  });

  it("keeps the newest reports and prunes the rest", () => {
    const dir = path.join(
      globalDir,
      "sessions",
      "cache-break-session",
      "cache-breaks",
    );
    for (let i = 0; i < 3; i++) {
      writeCacheBreakReport({
        verdict: { state: "invalidated", reasons: ["model"] },
        previous: header(),
        current: header({ model: `model-${i}` }),
        assessment: {
          report: true,
          previousRate: 1,
          currentRate: 0,
          dropPoints: 100,
          missedTokens: 100_000,
        },
      });
    }

    expect(fs.readdirSync(dir).length).toBeLessThanOrEqual(20);
    expect(fs.readdirSync(dir).length).toBe(3);
  });

  it("gives up the path but not the report when nothing can be written", () => {
    // A session store that cannot hold a directory is the failure to test for:
    // the numbers still have to reach the log.
    process.env.TNT_GLOBAL_DIR = path.join(globalDir, "not-a-directory");
    fs.writeFileSync(
      path.join(globalDir, "not-a-directory"),
      "occupied",
      "utf-8",
    );

    const file = writeCacheBreakReport({
      verdict: { state: "invalidated", reasons: ["model"] },
      previous: header(),
      current: header({ model: "other" }),
      assessment: {
        report: true,
        previousRate: 1,
        currentRate: 0,
        dropPoints: 100,
        missedTokens: 100_000,
      },
    });

    expect(file).toBeUndefined();
  });
});
