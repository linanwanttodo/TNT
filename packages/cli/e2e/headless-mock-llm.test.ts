import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  setupMockLLMTest,
  cleanupMockLLMServer,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

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
    // The prompt request plus the title request for the new session; they run
    // concurrently, so identify them by content instead of arrival order.
    expect(mockServer.requests).toHaveLength(2);
    const titleRequest = mockServer.requests.find((request: any) =>
      String(request.body.messages[0]?.content ?? "").includes(
        "title for the chat",
      ),
    );
    expect(titleRequest?.body.stream).toBe(false);
    const mainRequest = mockServer.requests.find((request: any) =>
      request.body.messages.some(
        (m: any) =>
          m.role === "user" && String(m.content ?? "").includes("Say hello"),
      ),
    );
    expect(mainRequest).toBeDefined();
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
    // The prompt request plus the title request for the new session. The two
    // run concurrently, so find the prompt by its content rather than by order.
    expect(mockServer.requests).toHaveLength(2);
    const prompt =
      "Please respond with exactly 'Hello World!' and nothing else";
    const mainRequest = mockServer.requests.find((request: any) =>
      request.body.messages.some(
        (m: any) =>
          m.role === "user" && String(m.content ?? "").includes(prompt),
      ),
    );
    expect(mainRequest).toBeDefined();
  }, 20000);
});
