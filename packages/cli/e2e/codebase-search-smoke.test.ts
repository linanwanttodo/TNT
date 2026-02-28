import * as fs from "fs/promises";
import * as http from "http";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  fixtureApiKeyLine,
  fixtureKey,
} from "../test-utils/fixtureCredentials.js";
import {
  cleanupMockLLMServer,
  createMockLLMServer,
} from "../test-utils/mock-llm-server.js";

/**
 * The v1.0 "understands the codebase" claim, end to end: the CLI builds an
 * index, the model asks for CodebaseSearch, the tool result goes back to the
 * model in the next request, and the final answer follows from it. Embeddings
 * come from the mock so the smoke needs no network and no hosted provider.
 */
const EMBEDDING_DIMENSIONS = 384;

function vector(): number[] {
  return new Array(EMBEDDING_DIMENSIONS).fill(0.01);
}

function sse(res: http.ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

describe("E2E: codebase search reaches the model", () => {
  let context: Awaited<ReturnType<typeof createTestContext>>;
  let mockServer: Awaited<ReturnType<typeof createMockLLMServer>>;
  let toolResult: string | null = null;
  let chatRequests = 0;
  let requestPaths: string[] = [];

  beforeEach(async () => {
    toolResult = null;
    chatRequests = 0;
    requestPaths = [];
    context = await createTestContext();

    mockServer = await createMockLLMServer({
      customHandler: (req, res) => {
        requestPaths.push(`${req.method} ${req.url}`);
        void (async () => {
          if (req.method === "POST" && req.url === "/embeddings") {
            const body = await readBody(req);
            const inputs: unknown[] = Array.isArray(body.input)
              ? body.input
              : [body.input];
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                object: "list",
                model: body.model,
                data: inputs.map((_, index) => ({
                  object: "embedding",
                  index,
                  embedding: vector(),
                })),
                usage: { prompt_tokens: 1, total_tokens: 1 },
              }),
            );
            return;
          }

          if (req.method === "POST" && req.url === "/chat/completions") {
            const body = await readBody(req);
            chatRequests += 1;

            // The title call is not streamed and must not trigger a tool:
            // a second concurrent index build races the real search.
            if (body.stream === false) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  choices: [
                    { message: { content: "title" }, finish_reason: "stop" },
                  ],
                }),
              );
              return;
            }

            const messages: any[] = body.messages ?? [];
            const toolMessages = messages.filter(
              (message) => message.role === "tool",
            );

            if (toolMessages.length > 0) {
              toolResult = String(toolMessages.at(-1).content);
              sse(res, [
                {
                  choices: [{ delta: { content: "Cited the search result." } }],
                },
                {
                  choices: [{ delta: {}, finish_reason: "stop" }],
                  usage: { prompt_tokens: 10, completion_tokens: 5 },
                },
              ]);
              return;
            }

            const lastUser = messages
              .filter((message) => message.role === "user")
              .at(-1)?.content;
            if (!String(lastUser ?? "").includes("search the codebase")) {
              sse(res, [
                { choices: [{ delta: { content: "title" } }] },
                { choices: [{ delta: {}, finish_reason: "stop" }] },
              ]);
              return;
            }

            sse(res, [
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_search",
                          type: "function",
                          function: { name: "CodebaseSearch" },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          function: {
                            arguments: JSON.stringify({
                              query: "computeFibonacciSequence",
                            }),
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              },
            ]);
            return;
          }

          res.writeHead(404);
          res.end("Not found");
        })();
      },
    });

    const configPath = path.join(context.testDir, "smoke-config.yaml");
    await fs.writeFile(
      configPath,
      `name: Smoke
version: 0.0.1
schema: v1
models:
  - name: chat
    provider: openai
    model: gpt-4
${fixtureApiKeyLine("    ", fixtureKey("default"))}
    apiBase: ${mockServer.url}
    roles:
      - chat
  - name: embed
    provider: openai
    model: text-embedding-3-small
${fixtureApiKeyLine("    ", fixtureKey("default"))}
    apiBase: ${mockServer.url}
    roles:
      - embed
context:
  - provider: codebase
`,
    );
    context.configPath = configPath;

    // The retrieval service reads the workspace's own config (its embeddings
    // role) from the global directory, not the --config flag.
    await fs.mkdir(path.join(context.testDir, ".tnt"), { recursive: true });
    await fs.writeFile(
      path.join(context.testDir, ".tnt", "config.yaml"),
      await fs.readFile(configPath, "utf-8"),
    );

    await fs.mkdir(path.join(context.testDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(context.testDir, "src", "math.ts"),
      "export function computeFibonacciSequence(n: number): number {\n  return n;\n}\n",
    );
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("indexes, searches, and sends the hit to the model", async () => {
    const result = await runCLI(context, {
      args: [
        "-p",
        "--config",
        context.configPath!,
        "Please search the codebase for computeFibonacciSequence",
      ],
      timeout: 90_000,
    });

    // An empty result is the only symptom this suite had for a long time, and
    // it says nothing about which stage came up short: the tool echoes the
    // query into "No matches", so the run's own stderr and the requests the
    // mock actually saw are what make a red run here readable.
    const detail = `tool result: ${JSON.stringify(toolResult)}\nrequests seen: ${requestPaths.join(", ")}\nstderr: ${result.stderr.slice(-1500)}`;

    expect(result.exitCode).toBe(0);
    expect(result.stdout, detail).toContain("Cited the search result.");
    expect(chatRequests).toBeGreaterThanOrEqual(2);
    expect(requestPaths).toContain("POST /embeddings");
    expect(toolResult, detail).toContain(path.join("src", "math.ts"));
    expect(toolResult).toMatch(/:\d+:\d+/);
  }, 120_000);
});
