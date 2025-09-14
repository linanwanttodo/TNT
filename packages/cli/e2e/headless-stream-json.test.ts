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

describe("E2E: Headless Mode with stream-json Format", () => {
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

  function parseEvents(stdout: string): any[] {
    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    return lines.map((line) => JSON.parse(line));
  }

  it("emits assistant, turn-end and result events, in that order", async () => {
    const responseText = "Done: two files updated";
    mockServer = await setupMockLLMTest(context, {
      response: responseText,
      streaming: false,
    });

    const result = await runCLI(context, {
      args: [
        "-p",
        "--format",
        "stream-json",
        "--config",
        context.configPath,
        "Test prompt",
      ],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    const events = parseEvents(result.stdout);

    expect(events.map((event) => event.type)).toEqual([
      "assistant",
      "turn-end",
      "result",
    ]);
    expect(events[0].content).toBe(responseText);
    expect(events[1].reason).toBe("no_tool_calls");
    expect(events[2].subtype).toBe("success");
    expect(events[2].content).toBe(responseText);
    expect(typeof events[2].usage.totalCost).toBe("number");
    expect(typeof events[2].usage.promptTokens).toBe("number");
  }, 20000);

  it("keeps a multi-line answer inside a single JSON line", async () => {
    mockServer = await setupMockLLMTest(context, {
      response: "line one\nline two",
      streaming: false,
    });

    const result = await runCLI(context, {
      args: [
        "-p",
        "--format",
        "stream-json",
        "--config",
        context.configPath,
        "Test prompt",
      ],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    const events = parseEvents(result.stdout);
    const assistant = events.find((event) => event.type === "assistant");
    expect(assistant.content).toBe("line one\nline two");
  }, 20000);

  it("does not ask the model for a JSON-shaped answer", async () => {
    mockServer = await setupMockLLMTest(context, {
      response: "plain text answer",
    });

    const result = await runCLI(context, {
      args: [
        "-p",
        "--format",
        "stream-json",
        "--config",
        context.configPath,
        "Hello",
      ],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    const systemMessage = mockServer.requests[0].body.messages.find(
      (message: any) => message.role === "system",
    );
    expect(systemMessage.content).not.toContain("JSON output mode");
    expect(systemMessage.content).toContain("headless mode");
  }, 20000);

  it("ends the stream with an error result when the run fails", async () => {
    const result = await runCLI(context, {
      args: [
        "-p",
        "--format",
        "stream-json",
        "--config",
        "/nonexistent/config.json",
        "Test prompt",
      ],
      timeout: 10000,
      expectError: true,
    });

    expect(result.exitCode).toBe(1);
    const events = parseEvents(result.stdout);
    const last = events[events.length - 1];
    expect(last.type).toBe("result");
    expect(last.subtype).toBe("error");
    expect(typeof last.error).toBe("string");
  }, 15000);
});
