import fs from "fs";
import type * as http from "http";
import path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

/**
 * The headless deadline has to reach the work it is bounding. Two things can
 * outlive it: a tool that is already running, and the post-turn calls that
 * answer for the turn (schema repair, session title). Both are asserted against
 * the built bundle: the run must end near the deadline, and the server must see
 * no request after it.
 */

const sleepCommand =
  process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";

function streamHead(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function streamToolCall(
  res: http.ServerResponse,
  name: string,
  args: unknown,
): void {
  streamHead(res);
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_slow",
                type: "function",
                function: { name },
              },
            ],
          },
          index: 0,
        },
      ],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: JSON.stringify(args) } },
            ],
          },
          index: 0,
        },
      ],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }],
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function streamText(res: http.ServerResponse, text: string): void {
  streamHead(res);
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: text }, index: 0 }],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

/** One assistant message that both says something and asks for a tool. */
function streamTextAndToolCall(
  res: http.ServerResponse,
  text: string,
  name: string,
  args: unknown,
): void {
  streamHead(res);
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: text }, index: 0 }],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_after_text",
                type: "function",
                function: { name },
              },
            ],
          },
          index: 0,
        },
      ],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: JSON.stringify(args) } },
            ],
          },
          index: 0,
        },
      ],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }],
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function eventsOf(stdout: string): any[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter((event): event is any => event !== undefined);
}

function turnEndReason(stdout: string): string | undefined {
  const turnEnd = eventsOf(stdout).find((event) => event.type === "turn-end");
  return turnEnd?.reason;
}

describe("E2E: the headless deadline bounds what it says it bounds", () => {
  let context: any;
  let mockServer: MockLLMServer | undefined;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (mockServer) {
      await cleanupMockLLMServer(mockServer);
      mockServer = undefined;
    }
    await cleanupTestContext(context);
  });

  it("stops a running command instead of waiting for it to finish", async () => {
    let nonStreamingRequests = 0;
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req: http.IncomingMessage, res: http.ServerResponse) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          const parsed = body ? JSON.parse(body) : {};
          if (parsed.stream === false) {
            nonStreamingRequests += 1;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                id: "title",
                object: "chat.completion",
                created: 0,
                model: "gpt-4",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "Title" },
                  },
                ],
              }),
            );
            return;
          }
          streamToolCall(res, "Bash", { command: sleepCommand, timeout: 600 });
        });
      },
    });

    const started = Date.now();
    const result = await runCLI(context, {
      args: [
        "-p",
        "--auto",
        "--request-timeout",
        "2",
        "--config",
        context.configPath,
        "--format",
        "stream-json",
        "run the slow command",
      ],
      // The command sleeps for 30 seconds; a run that waits for it cannot
      // finish inside this budget, which is what makes the deadline the thing
      // under test rather than the harness's patience.
      timeout: 45000,
    });

    expect(Date.now() - started).toBeLessThan(20_000);
    expect(result.exitCode).toBe(1);
    expect(turnEndReason(result.stdout)).toBe("request_timeout");
    expect(result.stderr).toContain("time limit");
    // Neither the schema repair nor the session title may run after the
    // deadline: they are model calls the deadline does not reach.
    expect(nonStreamingRequests).toBe(0);
  }, 90000);

  it("does not repair the answer or title the session after a truncated run", async () => {
    const schemaPath = path.join(context.testDir, "answer.schema.json");
    fs.writeFileSync(
      schemaPath,
      JSON.stringify({ type: "object", required: ["field"] }),
    );

    let nonStreamingRequests = 0;
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req: http.IncomingMessage, res: http.ServerResponse) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          const parsed = body ? JSON.parse(body) : {};
          if (parsed.stream === false) {
            nonStreamingRequests += 1;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                id: "side",
                object: "chat.completion",
                created: 0,
                model: "gpt-4",
                choices: [
                  { index: 0, message: { role: "assistant", content: "{}" } },
                ],
              }),
            );
            return;
          }
          // Text first, then a tool call: the turn is cut by --max-steps with a
          // partial answer already in hand, which is exactly when repair and
          // title generation used to spend two more model calls.
          streamTextAndToolCall(
            res,
            "Partial answer that is not JSON",
            "Bash",
            {
              command: "echo hi",
            },
          );
        });
      },
    });

    const result = await runCLI(context, {
      args: [
        "-p",
        "--auto",
        "--max-steps",
        "1",
        "--output-schema",
        schemaPath,
        "--config",
        context.configPath,
        "--format",
        "stream-json",
        "answer in a schema",
      ],
      timeout: 45000,
    });

    expect(result.exitCode).toBe(1);
    expect(turnEndReason(result.stdout)).toBe("max_steps");
    expect(nonStreamingRequests).toBe(0);
  }, 90000);
});
