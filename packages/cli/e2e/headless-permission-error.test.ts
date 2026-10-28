/**
 * E2E test for headless mode permission errors
 * Verifies that when a tool requires permission in headless mode,
 * an appropriate error message is displayed suggesting the --auto flag
 */
import * as http from "http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("E2E: Headless Mode Permission Errors", () => {
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

  it("should succeed with --auto flag when tool requires permission", async () => {
    // The mock answers the tool call exactly once. Handled every request the
    // same way, it asks for the same `Write` on every turn and the agent loop
    // runs to its step limit (128 model round trips, measured ~4.6s on an idle
    // machine) before it can say it is done - which is how this case came to
    // need 30s and to time out on a lane with the other twenty suites beside it.
    let requests = 0;
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req: http.IncomingMessage, res: http.ServerResponse) => {
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
            requests += 1;

            if (requests > 1) {
              // The write has been done; close the turn so the loop ends.
              res.write(
                `data: {"choices":[{"delta":{"content":"Created test.txt."}}],"index":0}\n\n`,
              );
              res.write(
                `data: {"usage":{"prompt_tokens":5,"completion_tokens":5}}\n\n`,
              );
              res.write(`data: [DONE]\n\n`);
              res.end();
              return;
            }

            // Send a Write tool call
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_write","type":"function","function":{"name":"Write"}}]},"index":0}]}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"filepath\\":\\"test.txt\\",\\"content\\":\\"hello\\"}"}}]},"index":0}]}\n\n`,
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

    // Run CLI with --auto flag. The ceiling covers the spawn of the built
    // bundle (6.5s measured on an idle runner) with room for the suite running
    // beside it; the run itself is two model turns now, not 128.
    const result = await runCLI(context, {
      args: [
        "-p",
        "--auto",
        "--config",
        context.configPath,
        "Create a file test.txt",
      ],
      timeout: 30000,
    });

    // Should succeed, and because the model stopped asking - not because the
    // loop ran out of steps, which is what made this case depend on the clock.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("requires permission");
    expect(result.stdout).toContain("Created test.txt.");
    expect(`${result.stdout}${result.stderr}`).not.toContain("step limit");
  }, 60000);

  it("should succeed with --allow flag for specific tool", async () => {
    // One tool call, then a closing turn - the same reason as above.
    let requests = 0;
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req: http.IncomingMessage, res: http.ServerResponse) => {
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
            requests += 1;

            if (requests > 1) {
              res.write(
                `data: {"choices":[{"delta":{"content":"Created test.txt."}}],"index":0}\n\n`,
              );
              res.write(`data: [DONE]\n\n`);
              res.end();
              return;
            }

            // Send a Write tool call
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_write","type":"function","function":{"name":"Write"}}]},"index":0}]}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"filepath\\":\\"test.txt\\",\\"content\\":\\"hello\\"}"}}]},"index":0}]}\n\n`,
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

    // Run CLI with --allow Write flag
    const result = await runCLI(context, {
      args: [
        "-p",
        "--allow",
        "Write",
        "--config",
        context.configPath,
        "Create a file test.txt",
      ],
      timeout: 30000,
    });

    // Should succeed for the same reason: the write was allowed and the model
    // closed the turn instead of asking again.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("requires permission");
    expect(result.stdout).toContain("Created test.txt.");
    expect(`${result.stdout}${result.stderr}`).not.toContain("step limit");
  }, 60000);
});
