import {
  cleanupTestContext,
  createTestContext,
  readSession,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

/**
 * A provider may report a call's counts in an event carrying no choices at all
 * - Bedrock's trailing metadata event is that shape - and the CLI reads usage
 * before the guard that skips choice-less chunks. Pinned on the built bundle:
 * move that read behind the guard and the saved session accounts zero tokens.
 */
describe("E2E: a usage-only stream chunk is still metered", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      response: "counted response",
      usage: {
        prompt_tokens: 4321,
        completion_tokens: 87,
        total_tokens: 4408,
      },
    });
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("saves the counts from that chunk into the session", async () => {
    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "Hi"],
      timeout: 20000,
    });

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);

    const session = await readSession(context);
    // The helper picks the session out of the directory that also holds the
    // `sessions.json` listing; reading that file instead has no history at all.
    expect(typeof session.sessionId).toBe("string");
    const assistant = session.history.find(
      (entry: any) => entry.message.role === "assistant",
    );

    // Neither number can come out of a local tokenizer here, so seeing them
    // means the chunk's usage is what the run accounted with.
    expect(assistant.message.usage.prompt_tokens).toBe(4321);
    expect(assistant.message.usage.completion_tokens).toBe(87);
    expect(session.usage.promptTokens).toBe(4321);
    expect(session.usage.completionTokens).toBe(87);
  }, 30000);
});
