import fs from "fs";
import type * as http from "http";
import path from "path";

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
 * Every round asks for one more tool call and answers a second and a bit later,
 * so no single response reaches the three-second bound on its own. Only a bound
 * that spans the whole turn stops this run, which is what the flag's wording and
 * the architecture doc now claim - measured here rather than read off the call
 * structure.
 */
describe("E2E: --request-timeout spans the tool rounds of one turn", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
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
          setTimeout(() => {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_${Date.now()}","type":"function","function":{"name":"list_files"}}]},"index":0}]}\n\n`,
            );
            res.write(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"index":0}]}\n\n',
            );
            res.write(
              'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
            );
            res.write("data: [DONE]\n\n");
            res.end();
          }, 1200);
        });
      },
    });
    fs.writeFileSync(
      path.join(context.testDir, ".tnt", "settings.json"),
      JSON.stringify({ locale: "en" }),
    );
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("stops the turn at the bound, not the round trip", async () => {
    const started = Date.now();

    const result = await runCLI(context, {
      args: [
        "--request-timeout",
        "3",
        "--auto",
        "-p",
        "--config",
        context.configPath,
        "--format",
        "stream-json",
        "keep asking for tools",
      ],
      timeout: 60000,
      expectError: true,
    });

    const events = result.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
    const elapsed = Date.now() - started;

    // Several rounds happened: the turn was cut, it did not end on its own.
    expect(
      events.filter((e) => e.type === "tool-start").length,
    ).toBeGreaterThan(0);
    expect(
      events.some(
        (e) => e.type === "turn-end" && e.reason === "request_timeout",
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "result" && e.subtype === "error"),
    ).toBe(true);
    expect(result.exitCode).toBe(1);
    // The bound ended it, not the caller's budget: one round is 1.2 s of waiting.
    expect(elapsed).toBeLessThan(20000);
    expect(elapsed).toBeGreaterThanOrEqual(3000);
  }, 70000);
});
