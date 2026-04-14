import * as http from "http";

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

describe("E2E: Headless Mode with Tool Calls", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (mockServer) {
      await cleanupMockLLMServer(mockServer);
    }
    await cleanupTestContext(context);
  });

  it("prints nothing when a bounded turn contains only tool calls", async () => {
    // A mock that answers every round with a tool call has no natural ending,
    // and a turn has no default round ceiling, so the run is bounded explicitly
    // here. The turn then stops without text, which is what this case pins.

    mockServer = await setupMockLLMTest(context, {
      customHandler: (req: http.IncomingMessage, res: http.ServerResponse) => {
        // Collect request body first
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          if (req.method === "POST" && req.url === "/chat/completions") {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });

            // Send only tool call (no text content)
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"search_code"}}]},"index":0}]}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"pattern\\":\\"createTestContext\\"}"}}]},"index":0}]}\n\n`,
            );

            // Send usage data
            res.write(
              `data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n`,
            );

            // End the stream
            res.write(`data: [DONE]\n\n`);
            res.end();
          } else {
            res.writeHead(404);
            res.end("Not found");
          }
        });
      },
    });

    // Run the CLI with print mode (-p)
    const result = await runCLI(context, {
      args: [
        "--max-steps",
        "1",
        "-p",
        "--config",
        context.configPath,
        "Test with tool calls",
      ],
      // The helper's default is 20s and this case asks for more, because it is
      // the run whose output is expected to stay empty: a killed child and a
      // correct run are indistinguishable here, so the budget has to cover the
      // slowest runner rather than the average one.
      timeout: 30000,
    });

    // Nothing was answered before the turn was cut short, so nothing is
    // printed - and a truncated run is a failed run.
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  }, 40000);
});
