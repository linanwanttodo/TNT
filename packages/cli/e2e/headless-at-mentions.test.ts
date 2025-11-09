import * as fs from "fs/promises";
import * as path from "path";

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

describe("E2E: @-mention context in a headless run", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      response: "The parser throws on the marker line.",
    });
    await fs.writeFile(
      path.join(context.testDir, "subject.ts"),
      "export const marker = onlyInThisFile;\n",
    );
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("sends the mentioned file's contents alongside the prompt", async () => {
    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "why fails @subject.ts ?"],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);

    const userMessage = mockServer.requests[0].body.messages.find(
      (m: any) => m.role === "user",
    );
    // The expansion is prepended as a context block, and the text the user
    // typed is left exactly as typed.
    expect(userMessage.content).toContain('<context name="subject.ts">');
    expect(userMessage.content).toContain("onlyInThisFile");
    expect(userMessage.content).toContain("why fails @subject.ts ?");
  }, 20000);

  it("leaves a prompt without mentions untouched", async () => {
    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "Say hello"],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    const userMessage = mockServer.requests[0].body.messages.find(
      (m: any) => m.role === "user",
    );
    expect(userMessage.content).toBe("Say hello");
  }, 20000);
});
