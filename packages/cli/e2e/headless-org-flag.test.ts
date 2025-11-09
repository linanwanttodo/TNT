import {
  createTestContext,
  cleanupTestContext,
  runCLI,
  createTestConfig,
} from "../test-utils/cli-helpers.js";

describe("E2E: Headless Mode with --org flag", () => {
  let context: any;

  const testConfig = `name: Test Assistant
version: 1.0.0
schema: v1
models:
  - name: test-model
    model: gpt-4
    provider: openai
    apiBase: http://127.0.0.1:9/v1
    apiKey: test-key`;

  const testEnv = {
    OPENAI_API_KEY: "test-key",
    CONTINUE_API_KEY: "test-api-key",
  };

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  describe("--org flag mode restriction", () => {
    it("should fail when --org is used without -p flag (interactive mode)", async () => {
      await createTestConfig(context, testConfig);

      const result = await runCLI(context, {
        args: [
          "--config",
          context.configPath,
          "--org",
          "my-org",
          "Test prompt",
        ],
        env: testEnv,
        expectError: true,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "Cannot start TUI in TTY-less environment",
      );
    });

    it("should accept --org flag with -p flag (headless mode)", async () => {
      await createTestConfig(context, testConfig);

      // Port 9 is discard: nothing ever listens there, so the provider
      // call is refused immediately instead of hanging on outbound access. What is
      // under test is the flag, not the network.
      const result = await runCLI(context, {
        args: [
          "-p",
          "--config",
          context.configPath,
          "--org",
          "my-org",
          "Test prompt",
        ],
        env: testEnv,
        expectError: true,
      });

      // Fails because the provider connection was refused, not because the
      // flag was rejected.
      expect(result.stderr).not.toContain(
        "--org flag is only supported in headless mode (with -p/--print flag)",
      );
    });
  });

  describe("--org flag inheritance", () => {
    it("should inherit --org flag from parent command", async () => {
      await createTestConfig(context, testConfig);

      // Test with chat subcommand
      const result = await runCLI(context, {
        args: [
          "--org",
          "test-org",
          "chat",
          "-p",
          "--config",
          context.configPath,
          "Test prompt",
        ],
        env: testEnv,
        expectError: true,
      });

      // The org flag should be inherited and work in headless mode
      expect(result.stderr).not.toContain(
        "--org flag is only supported in headless mode (with -p/--print flag)",
      );
    });
  });
});
