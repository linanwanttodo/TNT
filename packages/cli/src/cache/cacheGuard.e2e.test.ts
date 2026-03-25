import * as fs from "fs";
import * as http from "http";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
  type CLITestContext,
} from "../../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../../test-utils/mock-llm-server.js";

import {
  cacheHitFloor,
  meetsCacheHitFloor,
  tailCacheHitRate,
} from "./cacheHitGuard.js";

/**
 * The break detector is only worth its noise if the whole chain holds: the
 * provider's cache-read numbers, the prefix comparison, the threshold, and the
 * report file. This runs the built CLI against a provider that answers the way
 * a prompt cache does - a round pays for the prefix only when the previous
 * round's messages survive at its head, and the tools and model are unchanged.
 *
 * The two scenarios are the two directions of the guard: a growing session must
 * stay quiet, and a round that really loses its cache must leave one report.
 */
interface RequestBody {
  stream?: boolean;
  messages?: unknown[];
  tools?: unknown;
  model?: string;
}

interface CapturedTurn {
  turn: number;
  body: RequestBody;
  promptTokens: number;
  cacheReadTokens: number;
}

interface Prefix {
  messages: string[];
  tools: string;
  model: string;
}

const TOOL_ROUNDS = 6;
const CHARS_PER_TOKEN = 4;

describe("E2E: the cache guard holds for a growing session", () => {
  let context: CLITestContext;
  let mockServer: MockLLMServer;
  let turns: CapturedTurn[];
  let previous: Prefix | undefined;
  let streamingTurn: number;
  let toolRounds: number;
  let evictOnTurn: number | undefined;
  let previousPromptTokens: number;

  const sseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  function prefixOf(body: RequestBody): Prefix {
    return {
      messages: (body.messages ?? []).map((message: unknown) =>
        JSON.stringify(message),
      ),
      tools: JSON.stringify(body.tools ?? null),
      model: body.model ?? "",
    };
  }

  function prefixHolds(body: RequestBody): boolean {
    if (!previous) return false;
    const current = prefixOf(body);
    return (
      current.model === previous.model &&
      current.tools === previous.tools &&
      previous.messages.every(
        (message, index) => current.messages[index] === message,
      )
    );
  }

  /** Streams one tool call per round, then text on the last round. */
  function cachedProvider(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = (raw ? JSON.parse(raw) : {}) as RequestBody;
      res.writeHead(200, sseHeaders);

      // The session-title call is the one non-streaming request.
      if (body.stream === false) {
        res.write(`data: {"choices":[{"delta":{"content":"A title"}}]}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      streamingTurn += 1;
      const holds = prefixHolds(body);
      // Token count from the bytes the client actually sent, so the emulated
      // bill follows the prompt the request grew into rather than a constant.
      const promptTokens = Math.max(1, Math.ceil(raw.length / CHARS_PER_TOKEN));
      const cacheReadTokens =
        evictOnTurn === streamingTurn ? 0 : holds ? previousPromptTokens : 0;
      previousPromptTokens = promptTokens;
      previous = prefixOf(body);
      turns.push({ turn: streamingTurn, body, promptTokens, cacheReadTokens });

      if (streamingTurn < toolRounds) {
        const args = JSON.stringify({
          path: "." + "/".repeat(streamingTurn - 1),
        });
        const call = {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call_list_${streamingTurn}`,
                    type: "function",
                    function: { name: "List" },
                  },
                ],
              },
              index: 0,
            },
          ],
        };
        const argsChunk = {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: args } }],
              },
              index: 0,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(call)}\n\n`);
        res.write(`data: ${JSON.stringify(argsChunk)}\n\n`);
      } else {
        res.write(
          `data: {"choices":[{"delta":{"content":"done"},"index":0}]}\n\n`,
        );
      }

      const usage = {
        choices: [],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: 5,
          total_tokens: promptTokens + 5,
          prompt_tokens_details: { cached_tokens: cacheReadTokens },
        },
      };
      res.write(`data: ${JSON.stringify(usage)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  }

  const runEnv = () => ({
    TNT_TEST_SESSION_ID: "cache-guard-session",
    TNT_GLOBAL_DIR: path.join(context.testDir, ".tnt"),
  });

  const hitRateOf = (turn: CapturedTurn) =>
    turn.cacheReadTokens / turn.promptTokens;

  const promptArgs = (prompt: string) => [
    "-p",
    "--config",
    context.configPath as string,
    prompt,
  ];

  const resumeArgs = (prompt: string) => [
    "-p",
    "--resume",
    "--config",
    context.configPath as string,
    prompt,
  ];

  function cacheBreakReports(): string[] {
    const sessions = path.join(context.testDir, ".tnt", "sessions");
    const found: string[] = [];
    const walk = (directory: string): void => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(directory, entry.name);
        if (entry.name === "cache-breaks") {
          found.push(
            ...fs.readdirSync(full).map((file) => path.join(full, file)),
          );
          continue;
        }
        walk(full);
      }
    };
    walk(sessions);
    return found;
  }

  beforeEach(async () => {
    turns = [];
    previous = undefined;
    streamingTurn = 0;
    toolRounds = TOOL_ROUNDS;
    evictOnTurn = undefined;
    previousPromptTokens = 0;
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      customHandler: cachedProvider,
    });
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("calls no break while every round extends the cached prefix", async () => {
    const result = await runCLI(context, {
      args: promptArgs("List this directory"),
      env: runEnv(),
      timeout: 25000,
    });

    expect(result.exitCode).toBe(0);
    expect(turns.length).toBe(TOOL_ROUNDS);
    // The first round is cold; every later one reads the whole previous prompt.
    expect(turns[0].cacheReadTokens).toBe(0);
    expect(
      turns
        .slice(1)
        .every(
          (turn, index) => turn.cacheReadTokens === turns[index].promptTokens,
        ),
    ).toBe(true);

    // The tail is the sample the aggregate floor is measured on.
    const rates = turns.map(hitRateOf);
    expect(tailCacheHitRate(rates)).toBeGreaterThanOrEqual(cacheHitFloor());
    expect(meetsCacheHitFloor(rates)).toBe(true);
    expect(cacheBreakReports()).toEqual([]);
  }, 30000);

  it("writes one report when a round really loses its cache", async () => {
    // The provider evicts the prefix on the final round. The prefix still
    // matches, so the report is the one the bill asks for, not a drift.
    evictOnTurn = TOOL_ROUNDS;

    const result = await runCLI(context, {
      args: promptArgs("List this directory"),
      env: runEnv(),
      timeout: 25000,
    });

    expect(result.exitCode).toBe(0);
    const reports = cacheBreakReports();
    expect(reports).toHaveLength(1);

    const body = JSON.parse(fs.readFileSync(reports[0], "utf-8"));
    const previousTurn = turns[TOOL_ROUNDS - 2];
    const lastTurn = turns[TOOL_ROUNDS - 1];
    expect(body.hitRate.previous).toBeCloseTo(
      previousTurn.cacheReadTokens / previousTurn.promptTokens,
      4,
    );
    expect(body.hitRate.current).toBe(0);
    expect(body.missedTokens).toBe(
      Math.min(previousTurn.promptTokens, lastTurn.promptTokens),
    );

    // The reverse control for the aggregate floor: this session's tail really
    // is below it, so a guard that passes here would be measuring nothing.
    const rates = turns.map(hitRateOf);
    expect(meetsCacheHitFloor(rates)).toBe(false);
    expect(tailCacheHitRate(rates)).toBeLessThan(cacheHitFloor());
  }, 30000);

  it("keeps the prefix byte identical across a resume", async () => {
    // One text round per process. The resumed request has to carry the first
    // process's bytes at its head, and the provider has to see them as cached.
    toolRounds = 1;

    const firstRun = await runCLI(context, {
      args: promptArgs("List this directory"),
      env: runEnv(),
      timeout: 25000,
    });
    expect(firstRun.exitCode).toBe(0);
    const first = turns[0];
    expect(first).toBeDefined();
    const countBeforeResume = turns.length;

    const resumed = await runCLI(context, {
      args: resumeArgs("anything else?"),
      env: runEnv(),
      timeout: 25000,
    });
    expect(resumed.exitCode).toBe(0);

    const resumedTurn = turns[countBeforeResume];
    expect(resumedTurn).toBeDefined();
    const firstMessages = first.body.messages ?? [];
    const resumedMessages = resumedTurn.body.messages ?? [];
    expect(JSON.stringify(resumedMessages.slice(0, firstMessages.length))).toBe(
      JSON.stringify(firstMessages),
    );
    expect(JSON.stringify(resumedTurn.body.tools)).toBe(
      JSON.stringify(first.body.tools),
    );
    expect(resumedTurn.cacheReadTokens).toBe(first.promptTokens);
    expect(cacheBreakReports()).toEqual([]);
  }, 45000);
});
