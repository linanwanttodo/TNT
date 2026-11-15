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
 * `--format json` is read by a parser, so stdout has to be a document even when
 * the answer is nothing: an empty stdout is a JSON syntax error, and a consumer
 * cannot tell "the model said nothing" from "the CLI broke". Pinned on the built
 * bundle.
 */
describe("E2E: --format json answers with a document even when the answer is empty", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, { response: "" });
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("prints one parseable result whose response is empty", async () => {
    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "--format", "json", "hi"],
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.response).toBe("");
    // The wrapper would otherwise claim the answer "was not valid JSON", a
    // statement about text that never arrived.
    expect(result.stdout).not.toContain("not valid JSON");
  }, 40000);
});
