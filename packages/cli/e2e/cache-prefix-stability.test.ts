import * as http from "http";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../src/test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../src/test-utils/mock-llm-server.js";

/**
 * The cached prefix is worth money only while it stays byte identical, and it is
 * assembled from parts that no test looks at: the system message (rules, git
 * status, the mode line), the tool list and the frozen request fields. A tool list
 * that reorders itself, or a system block that gains a value, silently misses the
 * cache on every later request of the session. So this runs the built CLI against
 * a scripted provider and compares the bytes it actually sent.
 */
describe("E2E: the cached prefix stays byte identical", () => {
  let context: any;
  let mockServer: MockLLMServer;
  let captured: Array<{ url: string; body: any }>;

  const sseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  /** Streams one tool call, then text once a tool result has come back. */
  function scriptedProvider(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      captured.push({ url: req.url ?? "", body });
      res.writeHead(200, sseHeaders);

      // The session-title call is the one non-streaming request.
      if (body.stream === false) {
        res.write(`data: {"choices":[{"delta":{"content":"A title"}}]}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }

      const turnsAlready = captured.filter(
        (entry) => entry.body.stream !== false,
      ).length;
      if (turnsAlready === 1) {
        res.write(
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_list","type":"function","function":{"name":"List"}}]},"index":0}]}\n\n`,
        );
        res.write(
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\".\\"}"}}]},"index":0}]}\n\n`,
        );
      } else {
        res.write(`data: {"choices":[{"delta":{"content":"done"}}]}\n\n`);
      }
      res.write(
        `data: {"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105}}\n\n`,
      );
      res.write(`data: [DONE]\n\n`);
      res.end();
    });
  }

  const runEnv = () => ({
    CONTINUE_CLI_TEST_SESSION_ID: "cache-guard-session",
    CONTINUE_GLOBAL_DIR: path.join(context.testDir, ".tnt"),
  });

  const streamingTurns = () =>
    captured.filter((entry) => entry.body.stream !== false);

  function expectSameBytes(previous: any, current: any): void {
    expect(JSON.stringify(current)).toBe(JSON.stringify(previous));
  }

  beforeEach(async () => {
    captured = [];
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      customHandler: scriptedProvider,
    });
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("sends each round as the previous one plus an extension", async () => {
    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "List this directory"],
      env: runEnv(),
      timeout: 25000,
    });

    expect(result.exitCode).toBe(0);
    const [first, second] = streamingTurns();
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    // The whole earlier prefix, byte for byte, then the tool exchange on top.
    expectSameBytes(
      first.body.messages,
      second.body.messages.slice(0, first.body.messages.length),
    );
    expect(second.body.messages.length).toBeGreaterThan(
      first.body.messages.length,
    );
    // The schemas are part of the prefix the provider caches.
    expectSameBytes(first.body.tools, second.body.tools);
    expect(second.body.model).toBe(first.body.model);
  }, 30000);

  it("keeps the prefix across a resume, which is where drift shows up", async () => {
    const firstRun = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "List this directory"],
      env: runEnv(),
      timeout: 25000,
    });
    expect(firstRun.exitCode).toBe(0);
    const firstTurnOfFirstRun = streamingTurns()[0].body;
    const capturedBeforeResume = captured.length;

    const resumed = await runCLI(context, {
      // A resumed run with no new prompt asks nothing, so this one carries a
      // message: the point is the prefix of the request it then sends.
      args: [
        "-p",
        "--resume",
        "--config",
        context.configPath,
        "anything else?",
      ],
      env: runEnv(),
      timeout: 25000,
    });
    expect(resumed.exitCode).toBe(0);

    const afterResume = captured.slice(capturedBeforeResume);
    const resumedTurn = afterResume.find(
      (entry) => entry.body.stream !== false,
    );
    expect(resumedTurn).toBeDefined();

    // Everything the first process sent first is still the head of what the
    // second process sends: the system block and the tool schemas were rebuilt
    // from disk and came out the same.
    expectSameBytes(
      firstTurnOfFirstRun.messages,
      resumedTurn!.body.messages.slice(0, firstTurnOfFirstRun.messages.length),
    );
    expectSameBytes(firstTurnOfFirstRun.tools, resumedTurn!.body.tools);
  }, 40000);
});
