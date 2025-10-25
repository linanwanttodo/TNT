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
 * A provider that accepts the request and never answers used to leave a headless
 * run waiting indefinitely: the caller's own timeout killed it and said nothing
 * about why. The deadline is the product answer, so this pins it on the built
 * bundle against a server that stalls on purpose. The copy is pinned to English
 * because the message is what the test asserts and the host locale is not.
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

  it("returns with the deadline named instead of waiting forever", async () => {
    const started = Date.now();

    const result = await runCLI(context, {
      args: [
        "--request-timeout",
        "2",
        "-p",
        "--config",
        context.configPath,
        "hi",
      ],
      timeout: 60000,
      expectError: true,
    });

    expect(result.stderr).toContain("cut short after 2s");
    // The bound, not the caller's 60s budget, is what ended the run.
    expect(Date.now() - started).toBeLessThan(30000);
  }, 70000);
});
