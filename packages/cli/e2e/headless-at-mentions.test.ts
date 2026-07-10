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
    // The environment context now rides the first user message, so find the
    // message that carries the typed prompt rather than assuming position.
    const userMessage = mockServer.requests[0].body.messages.find(
      (m: any) =>
        m.role === "user" && String(m.content ?? "").includes("Say hello"),
    );
    expect(userMessage.content).toContain("Say hello");
    // No file mention was expanded; the environment context block is expected.
    expect(userMessage.content).not.toContain('name="subject.ts"');
    expect(userMessage.content).not.toContain("onlyInThisFile");
  }, 20000);
});
