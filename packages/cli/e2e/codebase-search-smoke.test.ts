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

/**
 * The run's own verdict lines, on their own and first: a CI annotation is
 * truncated, and in the last red runs everything past the tenth line went away -
 * which is exactly where "why did it build no index" sits.
 */
async function describeLogDecisions(testDir: string): Promise<string> {
  const decisions =
    /Not building indexes|asks for indexing|Unknown context provider|search failed|No matches|Indexed \d+ files|Starting file index|indexing/i;

  try {
    const log = await fs.readFile(
      path.join(testDir, ".tnt", "logs", "tnt.log"),
      "utf-8",
    );
    const lines = log.split("\n").filter((line) => decisions.test(line));

    return `decisions (${lines.length} of ${log.split("\n").length} lines):\n${lines
      .slice(-10)
      .join("\n")}`;
  } catch {
    return "cli log: absent";
  }
}

/**
 * What the run left behind, as text: whether an index directory was created at
 * all and what it holds. A red lane with this attached distinguishes "never
 * indexed" from "indexed and still missed"; without it, it cannot.
 */
async function describeRunArtifacts(testDir: string): Promise<string> {
  const parts: string[] = [];

  const indexDir = path.join(testDir, ".tnt", "index");
  try {
    const entries = await fs.readdir(indexDir, { withFileTypes: true });
    parts.push(
      `index dir: ${entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .join(", ")}`,
    );
  } catch (error) {
    parts.push(`index dir: none (${(error as Error).message})`);
  }

  parts.push(await describeIndexDb(path.join(indexDir, "index.sqlite")));

  const lancedb = path.join(indexDir, "lancedb");
  try {
    const tables = await fs.readdir(lancedb);
    parts.push(`lancedb tables: ${tables.join(", ") || "(empty)"}`);
  } catch {
    parts.push("lancedb: absent");
  }

  return parts.join("\n");
}

/**
 * Row counts of the index database. "The search found nothing" has at least
 * three causes behind it - nothing indexed, indexed under a key the query does
 * not use, indexed and not matched - and only the counts separate them. Never
 * throws: a diagnostic that can break a run is worse than no diagnostic.
 */
async function describeIndexDb(dbPath: string): Promise<string> {
  try {
    const sqlite3 = await import("sqlite3");
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    /** The driver is callback-shaped; this is the smallest promise wrapper. */
    const all = (sql: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) =>
        db.all(sql, (error, rows) =>
          error ? reject(error) : resolve(rows as Record<string, unknown>[]),
        ),
      );

    try {
      const tables = await all(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      );

      const counts = await Promise.all(
        tables.map(async (table) => {
          const rows = await all(
            `SELECT COUNT(*) AS n FROM "${String(table.name)}"`,
          );

          return `${String(table.name)}=${String(rows[0]?.n ?? "?")}`;
        }),
      );

      return `index tables: ${counts.join(", ") || "(none)"}`;
    } finally {
      await new Promise<void>((resolve) => db.close(() => resolve()));
    }
  } catch (error) {
    return `index tables: unreadable (${(error as Error).message})`;
  }
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
    // The index pipeline records why it built nothing at debug level, so a run
    // at the default level fails without ever saying so.
    const result = await runCLI(context, {
      args: [
        "-p",
        "--config",
        context.configPath!,
        "Please search the codebase for computeFibonacciSequence",
      ],
      env: { TNT_LOG_LEVEL: "debug" },
      timeout: 90_000,
    });

    // An empty result is the only symptom this suite had for a long time, and
    // it says nothing about which stage came up short: the tool echoes the
    // query into "No matches", so the run's own log, the index directory it
    // left behind and the requests the mock actually saw are what make a red
    // run here readable. The CI lanes failed twice with no way to tell whether
    // the index was never built or built and then missed.
    const detail = [
      // First, because a CI annotation is truncated and the reason is the part
      // that keeps getting cut off.
      await describeLogDecisions(context.testDir),
      `tool result: ${JSON.stringify(toolResult)}`,
      `requests seen: ${requestPaths.join(", ")}`,
      // Headless prints what the config layer complained about on stdout, ahead
      // of the answer, and an empty provider list is one of the few ways this
      // case can end with no index at all.
      `stdout: ${result.stdout.slice(0, 400)}`,
      `stderr: ${result.stderr.slice(-300)}`,
      await describeRunArtifacts(context.testDir),
    ].join("\n");

    expect(result.exitCode).toBe(0);
    expect(result.stdout, detail).toContain("Cited the search result.");
    expect(chatRequests).toBeGreaterThanOrEqual(2);
    expect(requestPaths).toContain("POST /embeddings");
    expect(toolResult, detail).toContain(path.join("src", "math.ts"));
    expect(toolResult).toMatch(/:\d+:\d+/);
  }, 120_000);
});
