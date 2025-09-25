import * as fs from "fs/promises";
import * as path from "path";

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

describe("E2E: notify command on headless completion", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (mockServer) {
      await cleanupMockLLMServer(mockServer);
      mockServer = undefined as any;
    }
    if (context) {
      await cleanupTestContext(context);
      context = undefined;
    }
  });

  async function writeNotifySetting(notify: unknown): Promise<void> {
    const settingsDir = path.join(context.testDir, ".tnt");
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({ notify }),
    );
  }

  it("runs the configured command with the payload as the final argument", async () => {
    const outPath = path.join(context.testDir, "notify.json");
    // sh -c script name payload: the payload lands in $1, as the contract says.
    await writeNotifySetting([
      "sh",
      "-c",
      `printf '%s' "$1" > '${outPath}'`,
      "notify",
    ]);
    mockServer = await setupMockLLMTest(context, {
      response: "Answer ready",
      streaming: false,
    });

    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "Test prompt"],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(await fs.readFile(outPath, "utf-8"));
    expect(payload.type).toBe("agent-turn-complete");
    expect(payload.lastAssistantMessage).toContain("Answer ready");
    expect(typeof payload.sessionId).toBe("string");
  }, 20000);

  it("does not fail the run when the notify command cannot start", async () => {
    await writeNotifySetting(["definitely-not-a-real-binary-xyz"]);
    mockServer = await setupMockLLMTest(context, {
      response: "Still fine",
      streaming: false,
    });

    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "Test prompt"],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Still fine");
  }, 20000);
});
