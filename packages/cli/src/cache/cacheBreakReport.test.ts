import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HIT_RATE_DROP_POINTS,
  MIN_REPORTED_INPUT_TOKENS,
  assessCacheBreak,
  cacheHitRate,
  describePrefixDiff,
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
  const warm = { inputTokens: 9000, cacheReadTokens: 8100 }; // 90%
  const cold = { inputTokens: 9000, cacheReadTokens: 2700 }; // 30%

  it("needs a previous round to call anything a drop", () => {
    expect(assessCacheBreak(undefined, cold).report).toBe(false);
  });

  it("stays quiet for a drop smaller than the threshold", () => {
    const slight = { inputTokens: 9000, cacheReadTokens: 7700 }; // ~85.6%
    expect(assessCacheBreak(warm, slight).dropPoints).toBeLessThanOrEqual(
      HIT_RATE_DROP_POINTS,
    );
    expect(assessCacheBreak(warm, slight).report).toBe(false);
  });

  it("stays quiet when the request is too short for the provider to have cached it", () => {
    expect(
      assessCacheBreak(warm, {
        inputTokens: MIN_REPORTED_INPUT_TOKENS - 1,
        cacheReadTokens: 0,
      }).report,
    ).toBe(false);
    expect(
      assessCacheBreak(warm, {
        inputTokens: MIN_REPORTED_INPUT_TOKENS,
        cacheReadTokens: 0,
      }).report,
    ).toBe(true);
  });

  it("calls a real drop on a billable request a break", () => {
    const assessment = assessCacheBreak(warm, cold);

    expect(assessment.report).toBe(true);
    expect(assessment.previousRate).toBeCloseTo(0.9, 4);
    expect(assessment.currentRate).toBeCloseTo(0.3, 4);
    expect(assessment.dropPoints).toBeCloseTo(60, 1);
  });

  it("remembers the round for the key it was given, not for every run", () => {
    forgetCacheRounds();
    expect(recallCacheRound("a")).toBeUndefined();

    recordCacheRound("a", warm);
    recordCacheRound("b", cold);

    expect(recallCacheRound("a")).toEqual(warm);
    expect(recallCacheRound("b")).toEqual(cold);

    forgetCacheRounds();
    expect(recallCacheRound("a")).toBeUndefined();
  });
});

describe("describePrefixDiff", () => {
  it("records the mode as context for a break that really happened", () => {
    const diff = describePrefixDiff(
      header({ mode: "agent" }),
      header({ mode: "plan", systemMessage: "line one\nline two moved" }),
      ["systemMessage"],
    ) as any;

    // The mode is not a reason - it never reaches the provider - but a reader of
    // the break file wants to know the session had switched.
    expect(diff.mode).toEqual({ before: "agent", after: "plan" });
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
      CONTINUE_GLOBAL_DIR: process.env.CONTINUE_GLOBAL_DIR,
      CONTINUE_CLI_TEST_SESSION_ID: process.env.CONTINUE_CLI_TEST_SESSION_ID,
    };
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-cache-breaks-"));
    process.env.CONTINUE_GLOBAL_DIR = globalDir;
    process.env.CONTINUE_CLI_TEST_SESSION_ID = "cache-break-session";
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
    expect(body.diff.systemMessage.added[0]).toContain("became something else");
  });

  it("keeps the newest reports and prunes the rest", () => {
    const dir = path.join(globalDir, "cache-breaks", "cache-break-session");
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
        },
      });
    }

    expect(fs.readdirSync(dir).length).toBeLessThanOrEqual(20);
    expect(fs.readdirSync(dir).length).toBe(3);
  });

  it("gives up the path but not the report when nothing can be written", () => {
    // A session store that cannot hold a directory is the failure to test for:
    // the numbers still have to reach the log.
    process.env.CONTINUE_GLOBAL_DIR = path.join(globalDir, "not-a-directory");
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
      },
    });

    expect(file).toBeUndefined();
  });
});
