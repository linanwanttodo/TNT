import fs from "fs";
import type * as http from "http";
import path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

/**
 * A headless run that stopped early is not a finished run. The process status
 * is what a CI job branches on, and the stream's `turn-end` event is what tells
 * a consumer why, so both are asserted here against the built bundle. Copy is
 * pinned to English because the host locale leaks into the child process.
 */

type Behaviour = "always-tool" | "tool-then-text" | "repeat-text";

const REPEATED_LINE =
  "the build fails because the generated client is missing the required export";

function sendJson(res: http.ServerResponse, value: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function startStream(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function writeContent(res: http.ServerResponse, content: string): void {
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { content }, index: 0 }],
    })}\n\n`,
  );
}

function writeToolCall(res: http.ServerResponse): void {
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_list",
                type: "function",
                function: { name: "list_files" },
              },
            ],
          },
          index: 0,
        },
      ],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: "{}" } }],
          },
          index: 0,
        },
      ],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }],
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function writeAssistantText(res: http.ServerResponse, text: string): void {
  startStream(res);
  writeContent(res, text);
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function respondToTitle(res: http.ServerResponse): void {
  sendJson(res, {
    id: "title",
    object: "chat.completion",
    created: 0,
    model: "gpt-4",
    choices: [{ index: 0, message: { role: "assistant", content: "Title" } }],
  });
}

function handlerFor(behaviour: Behaviour) {
  let streamingRequests = 0;
  return (req: http.IncomingMessage, res: http.ServerResponse): void => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/chat/completions") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const parsed = body ? JSON.parse(body) : {};
      if (parsed.stream === false) {
        respondToTitle(res);
        return;
      }
      streamingRequests += 1;
      if (behaviour === "always-tool") {
        startStream(res);
        writeToolCall(res);
        return;
      }
      if (behaviour === "tool-then-text" && streamingRequests === 1) {
        startStream(res);
        writeToolCall(res);
        return;
      }
      if (behaviour === "repeat-text") {
        writeAssistantText(res, Array(4).fill(REPEATED_LINE).join("\n"));
        return;
      }
      writeAssistantText(res, "Done after the tool round");
    });
  };
}

function eventsOf(stdout: string): any[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

describe("E2E: headless exit status matches how the turn ended", () => {
  let context: any;
  let mockServer: MockLLMServer | undefined;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (mockServer) {
      await cleanupMockLLMServer(mockServer);
      mockServer = undefined;
    }
    await cleanupTestContext(context);
  });

  async function start(behaviour: Behaviour): Promise<void> {
    mockServer = await setupMockLLMTest(context, {
      customHandler: handlerFor(behaviour),
    });
    fs.writeFileSync(
      path.join(context.testDir, ".tnt", "settings.json"),
      JSON.stringify({ locale: "en" }),
    );
  }

  it("fails when --max-steps ends the turn before the model answers", async () => {
    await start("always-tool");

    const result = await runCLI(context, {
      args: [
        "--max-steps",
        "1",
        "--auto",
        "-p",
        "--config",
        context.configPath,
        "--format",
        "stream-json",
        "keep asking for tools",
      ],
      timeout: 60000,
      expectError: true,
    });

    expect(result.exitCode).toBe(1);
    const events = eventsOf(result.stdout);
    expect(
      events.some((e) => e.type === "turn-end" && e.reason === "max_steps"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "result" && e.subtype === "error"),
    ).toBe(true);
    expect(result.stderr).toContain("step limit");
    expect(result.stderr).toContain("may be incomplete");
  }, 70000);

  it("succeeds when the model answers after its tool round without a ceiling", async () => {
    await start("tool-then-text");

    const result = await runCLI(context, {
      args: [
        "--auto",
        "-p",
        "--config",
        context.configPath,
        "--format",
        "stream-json",
        "use one tool, then answer",
      ],
      timeout: 60000,
    });

    const events = eventsOf(result.stdout);
    expect(
      events.some((e) => e.type === "turn-end" && e.reason === "no_tool_calls"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "result" && e.subtype === "success"),
    ).toBe(true);
    expect(result.stdout).toContain("Done after the tool round");
    expect(result.exitCode).toBe(0);
  }, 70000);

  it("fails when repeated output ends the turn", async () => {
    await start("repeat-text");

    const result = await runCLI(context, {
      args: [
        "--auto",
        "-p",
        "--config",
        context.configPath,
        "--format",
        "stream-json",
        "repeat yourself",
      ],
      timeout: 60000,
      expectError: true,
    });

    const events = eventsOf(result.stdout);
    expect(
      events.some((e) => e.type === "turn-end" && e.reason === "loop_detected"),
    ).toBe(true);
    expect(result.stderr).toContain("repeated itself");
    expect(result.exitCode).toBe(1);
  }, 70000);
});
