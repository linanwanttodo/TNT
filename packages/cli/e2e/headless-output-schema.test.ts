import * as fs from "fs/promises";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  createMockLLMConfig,
  createMockLLMServer,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

const SCHEMA = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
  additionalProperties: false,
};

describe("E2E: Headless Mode with --output-schema", () => {
  let context: any;
  let mockServer: MockLLMServer;
  let requests: string[] = [];

  beforeEach(async () => {
    context = await createTestContext();
    requests = [];
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

  async function writeSchema(schema: unknown): Promise<string> {
    const schemaPath = path.join(context.testDir, "output-schema.json");
    await fs.writeFile(schemaPath, JSON.stringify(schema));
    return schemaPath;
  }

  /**
   * Serves the turn as SSE (the CLI streams), and title/repair calls as plain
   * JSON (both are non-streaming side calls). Distinguishing them by content,
   * not by the stream flag alone, keeps the script readable.
   */
  async function startScriptedServer(script: {
    turn: string;
    repair?: string;
  }): Promise<void> {
    mockServer = await createMockLLMServer({
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          requests.push(body);
          const parsed = JSON.parse(body);
          const isRepair = body.includes("Response to fix");
          const content = isRepair
            ? (script.repair ?? "")
            : req.url === "/chat/completions" && parsed.stream
              ? script.turn
              : "Session Title";
          if (parsed.stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(
              `data: ${JSON.stringify({ choices: [{ delta: { content }, index: 0 }] })}\n\n`,
            );
            res.write("data: [DONE]\n\n");
            res.end();
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                id: "mock",
                object: "chat.completion",
                created: 0,
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                },
              }),
            );
          }
        });
      },
    });

    const configPath = path.join(context.testDir, "test-config.yaml");
    await fs.writeFile(configPath, createMockLLMConfig(mockServer));
    context.configPath = configPath;

    const onboardingFlagPath = path.join(
      context.testDir,
      ".tnt",
      ".onboarding_complete",
    );
    await fs.mkdir(path.dirname(onboardingFlagPath), { recursive: true });
    await fs.writeFile(onboardingFlagPath, new Date().toISOString());
  }

  async function run(schemaPath: string, extraArgs: string[] = []) {
    return runCLI(context, {
      args: [
        "-p",
        "--format",
        "json",
        "--output-schema",
        schemaPath,
        "--config",
        context.configPath,
        ...extraArgs,
        "Test prompt",
      ],
      timeout: 15000,
      expectError: true,
    });
  }

  it("sends the schema with the prompt and accepts a matching answer", async () => {
    await startScriptedServer({ turn: '{"name": "ok"}' });
    const schemaPath = await writeSchema(SCHEMA);

    const result = await run(schemaPath);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ name: "ok" });
    // The constraint reached the model: the schema is in the turn request
    // (serialized inside the body, so its quotes arrive escaped).
    const turnRequest = requests.find(
      (body) => !body.includes('"stream":false'),
    );
    expect(turnRequest).toContain("conforms to this JSON Schema");
    expect(turnRequest).toContain('\\"name\\"');
    // Nothing needed repairing.
    expect(requests.some((body) => body.includes("Response to fix"))).toBe(
      false,
    );
  }, 20000);

  it("asks for one repair when the answer does not match", async () => {
    await startScriptedServer({
      turn: '{"name": 42}',
      repair: '{"name": "ok"}',
    });
    const schemaPath = await writeSchema(SCHEMA);

    const result = await run(schemaPath);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ name: "ok" });
    const repairs = requests.filter((body) => body.includes("Response to fix"));
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toContain("$.name: expected string, got number");
  }, 20000);

  it("fails the run when the repaired answer still does not match", async () => {
    await startScriptedServer({ turn: '{"name": 1}', repair: '{"name": 2}' });
    const schemaPath = await writeSchema(SCHEMA);

    const result = await run(schemaPath);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "does not match --output-schema after one repair attempt",
    );
    expect(result.stderr).toContain("$.name: expected string, got number");
  }, 20000);

  it("refuses an unsupported schema keyword before any request", async () => {
    await startScriptedServer({ turn: '{"name": "ok"}' });
    const schemaPath = await writeSchema({
      oneOf: [{ type: "string" }, { type: "number" }],
    });

    const result = await run(schemaPath);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('\\"oneOf\\" is not supported');
    expect(requests).toHaveLength(0);
  }, 20000);
});
