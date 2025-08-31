import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../src/test-utils/cli-helpers.js";
import {
  setupMockLLMTest,
  cleanupMockLLMServer,
  type MockLLMServer,
} from "../src/test-utils/mock-llm-server.js";

describe("E2E: Headless Mode with Mock Server", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      response: "Hello World!",
    });
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it('should output "Hello World!" when using tnt -p "Hi"', async () => {
    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "Hi"],
      timeout: 15000,
    });

    // Verify stdout contains "Hello World!"
    expect(result.stdout).toContain("Hello World!");
    expect(result.exitCode).toBe(0);
  }, 20000);

  it("should handle streaming responses correctly", async () => {
    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "Say hello"],
      timeout: 15000,
    });

    expect(result.stdout).toContain("Hello World!");
    expect(result.exitCode).toBe(0);
    // The prompt request plus the title request for the new session
    expect(mockServer.requests).toHaveLength(2);
    // The title call is the small non-streaming completion
    expect(mockServer.requests[1].body.stream).toBe(false);
    expect(mockServer.requests[1].body.messages[0].content).toContain(
      "title for the chat",
    );
    // Find the user message (system message is first)
    const userMessage = mockServer.requests[0].body.messages.find(
      (m: any) => m.role === "user",
    );
    expect(userMessage.content).toBe("Say hello");
  }, 20000);

  it("should work with longer prompts", async () => {
    const result = await runCLI(context, {
      args: [
        "-p",
        "--config",
        context.configPath,
        "Please respond with exactly 'Hello World!' and nothing else",
      ],
      timeout: 15000,
    });

    expect(result.stdout).toContain("Hello World!");
    expect(result.exitCode).toBe(0);
    // The prompt request plus the title request for the new session
    expect(mockServer.requests).toHaveLength(2);
    // Find the user message (system message is first)
    const userMessage = mockServer.requests[0].body.messages.find(
      (m: any) => m.role === "user",
    );
    expect(userMessage.content).toBe(
      "Please respond with exactly 'Hello World!' and nothing else",
    );
  }, 20000);
});
