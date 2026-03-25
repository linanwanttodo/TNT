import {
  cleanupTestContext,
  createTestConfig,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  fixtureApiKeyLine,
  fixtureKey,
} from "../test-utils/fixtureCredentials.js";

/**
 * The usage block is printed only when the headless prompt guard refuses the run,
 * and its example lines are literal in both locales, so asserting on it keeps this
 * check independent of whatever language the child process answers in.
 */
const USAGE_BLOCK = 'tnt -p "please review my current git diff"';

describe("E2E: headless prompt sources", () => {
  let context: any;

  const testConfig = `name: Test Assistant
version: 1.0.0
schema: v1
models:
  - name: test-model
    model: gpt-4
    provider: openai
    apiBase: http://127.0.0.1:9/v1
${fixtureApiKeyLine("    ", fixtureKey("default"))}`;

  const testEnv = { OPENAI_API_KEY: fixtureKey("env") };

  beforeEach(async () => {
    context = await createTestContext();
    await createTestConfig(context, testConfig);
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  it("refuses -p with no prompt source at all", async () => {
    const result = await runCLI(context, {
      args: ["--config", context.configPath, "-p"],
      env: testEnv,
      expectError: true,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(USAGE_BLOCK);
  });

  it("accepts -p when --prompt is the only prompt source", async () => {
    const result = await runCLI(context, {
      args: ["--config", context.configPath, "-p", "--prompt", "hello there"],
      env: testEnv,
      expectError: true,
    });

    // The guard's own message names --prompt as a way to satisfy it, so a run that
    // uses that flag has to get past it. The turn still fails here - nothing is
    // listening on port 9 - but it fails as a request, not as a rejected invocation.
    expect(result.stderr).not.toContain(USAGE_BLOCK);
  });

  it("accepts -p when --prompt names a local file", async () => {
    const promptFile = `${context.testDir}/extra.md`;
    const fs = await import("fs");
    fs.writeFileSync(promptFile, "Review the diff.\n", "utf8");

    const result = await runCLI(context, {
      args: ["--config", context.configPath, "-p", "--prompt", promptFile],
      env: testEnv,
      expectError: true,
    });

    expect(result.stderr).not.toContain(USAGE_BLOCK);
  });
});
