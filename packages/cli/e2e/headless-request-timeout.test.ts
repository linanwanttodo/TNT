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
 * A provider that accepts the request and never answers is what the bound
 * exists for. Three things have to be true on the built bundle: the run ends by
 * itself, the event stream says it was the deadline rather than a person
 * pressing Ctrl+C, and the result line and exit code call it a failure. Copy is
 * pinned to English because the host locale leaks into the child process.
 */
describe("E2E: --request-timeout bounds a stalling provider", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      customHandler: (
        _req: http.IncomingMessage,
        _res: http.ServerResponse,
      ) => {
        // Read nothing, answer nothing: the socket stays open like a hung upstream.
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

  it("ends the run itself, with the deadline as the reason and a failed result", async () => {
    const started = Date.now();

    const result = await runCLI(context, {
      args: [
        "--request-timeout",
        "2",
        "-p",
        "--config",
        context.configPath,
        "--format",
        "stream-json",
        "hi",
      ],
      timeout: 60000,
      expectError: true,
    });

    const events = result.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));

    // The bound, not the caller's budget, ended the run.
    expect(Date.now() - started).toBeLessThan(30000);
    expect(
      events.some(
        (e) => e.type === "turn-end" && e.reason === "request_timeout",
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "result" && e.subtype === "error"),
    ).toBe(true);
    expect(result.exitCode).toBe(1);
  }, 70000);
});
