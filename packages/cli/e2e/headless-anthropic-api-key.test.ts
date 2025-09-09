import * as fs from "fs/promises";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../src/test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  createMockLLMServer,
  type MockLLMServer,
} from "../src/test-utils/mock-llm-server.js";

describe("E2E: Headless Mode with ANTHROPIC_API_KEY", () => {
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

  it("should work when ANTHROPIC_API_KEY is set in environment", async () => {
    // Create a mock LLM server using the same pattern as working tests
    mockServer = await createMockLLMServer({
      response: "Hello! This is a response from Claude.",
    });

    // The model and provider have to belong together: the CLI now refuses a
    // Claude model under an OpenAI provider (see the case below), and the mock
    // speaks the OpenAI wire format.
    const configContent = `name: Test Assistant
version: 1.0.0
schema: v1
models:
  - name: test-model
    model: gpt-4o
    provider: openai
    apiKey: test-key
    apiBase: ${mockServer.url}
    roles:
      - chat
`;

    const configPath = path.join(context.testDir, "test-config.yaml");
    await fs.writeFile(configPath, configContent);
    context.configPath = configPath;

    // Create onboarding flag to skip onboarding
    const onboardingFlagPath = path.join(
      context.testDir,
      ".tnt",
      ".onboarding_complete",
    );
    await fs.mkdir(path.dirname(onboardingFlagPath), { recursive: true });
    await fs.writeFile(onboardingFlagPath, new Date().toISOString());

    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "Hi there"],
      env: {
        ANTHROPIC_API_KEY: "test-api-key-from-env",
      },
      timeout: 15000,
    });

    // Verify the CLI successfully runs (even if not using env var in this test)
    expect(result.stdout).toContain("Hello! This is a response from Claude.");
    expect(result.exitCode).toBe(0);
    // The prompt request plus the title request for the new session
    expect(mockServer.requests).toHaveLength(2);

    // Find the user message in the request
    const userMessage = mockServer.requests[0].body.messages.find(
      (m: any) => m.role === "user",
    );
    expect(userMessage.content).toBe("Hi there");
  }, 20000);

  it("refuses a Claude model configured under an OpenAI provider", async () => {
    const configContent = `name: Test Assistant
version: 1.0.0
schema: v1
models:
  - name: mismatch
    model: claude-sonnet-4-5
    provider: openai
    apiKey: test-key
    apiBase: http://127.0.0.1:1
    roles:
      - chat
`;
    const configPath = path.join(context.testDir, "mismatch-config.yaml");
    await fs.writeFile(configPath, configContent);
    const onboardingFlagPath = path.join(
      context.testDir,
      ".tnt",
      ".onboarding_complete",
    );
    await fs.mkdir(path.dirname(onboardingFlagPath), { recursive: true });
    await fs.writeFile(onboardingFlagPath, new Date().toISOString());

    const result = await runCLI(context, {
      args: ["-p", "--config", configPath, "Hi there"],
      env: { ANTHROPIC_API_KEY: "test-api-key-from-env" },
      timeout: 15000,
      expectError: true,
    });

    // The pair is refused before any request is made, with the reason the user
    // needs - not a 400 from the provider about a field they never wrote.
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain(
      "is a Claude model, but it is configured with provider: openai",
    );
    expect(result.exitCode).not.toBe(0);
  }, 30000);
});
