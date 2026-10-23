import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import {
  cleanupTestContext,
  createTestContext,
  type CLITestContext,
} from "../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
  type MockLLMServerOptions,
} from "../test-utils/mock-llm-server.js";

interface Harness {
  child: ChildProcess;
  connection: acp.ClientConnection;
  ctx: acp.ClientContext;
  init: acp.InitializeResponse;
  stderr: () => string;
  permissionRequests: number;
  fsReads: acp.ReadTextFileRequest[];
  fsWrites: acp.WriteTextFileRequest[];
  terminalCreates: acp.CreateTerminalRequest[];
  terminalReleases: acp.ReleaseTerminalRequest[];
  updates: Array<{ sessionId: string; update: acp.SessionUpdate }>;
  close: () => Promise<void>;
}

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = 20_000,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
      timer.unref();
    }),
  ]);
}

async function startHarness(
  context: CLITestContext,
  project: string,
  options: {
    clientCapabilities?: acp.ClientCapabilities;
    mcpServers?: acp.McpServer[];
    additionalDirectories?: string[];
    terminal?: "foreground" | "hang";
  } = {},
): Promise<Harness> {
  const home = context.testDir;
  const globalDir = path.join(home, ".tnt");
  let stderr = "";
  const child = spawn(
    process.execPath,
    [context.cliPath, "--acp", "--config", context.configPath!],
    {
      cwd: home,
      env: {
        ...process.env,
        CONTINUE_CLI_TEST: "true",
        HOME: home,
        USERPROFILE: home,
        CONTINUE_GLOBAL_DIR: globalDir,
        TNT_GLOBAL_DIR: globalDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin!),
    Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
  );
  const app = acp.client({ name: "tnt-acp-e2e" });
  const harness = {} as Harness;
  harness.permissionRequests = 0;
  harness.fsReads = [];
  harness.fsWrites = [];
  harness.terminalCreates = [];
  harness.terminalReleases = [];
  harness.updates = [];
  app.onNotification(acp.methods.client.session.update, (notification) => {
    harness.updates.push(notification.params);
  });
  app.onRequest(acp.methods.client.session.requestPermission, async () => {
    harness.permissionRequests += 1;
    return { outcome: { outcome: "selected", optionId: "allow_once" } };
  });
  app.onRequest(acp.methods.client.fs.readTextFile, async (request) => {
    harness.fsReads.push(request.params);
    return { content: "from-editor\n" };
  });
  app.onRequest(acp.methods.client.fs.writeTextFile, async (request) => {
    harness.fsWrites.push(request.params);
    return {};
  });
  app.onRequest(acp.methods.client.terminal.create, async (request) => {
    harness.terminalCreates.push(request.params);
    return { terminalId: "terminal-e2e" };
  });
  let backgroundPolls = 0;
  app.onRequest(acp.methods.client.terminal.output, async () => {
    if (options.terminal === "hang") {
      backgroundPolls += 1;
      return backgroundPolls === 1
        ? { output: "bg-partial\n", truncated: false }
        : {
            output: "bg-done\n",
            truncated: false,
            exitStatus: { exitCode: 0, signal: null },
          };
    }
    return { output: "client-terminal-output\n", truncated: false };
  });
  app.onRequest(acp.methods.client.terminal.waitForExit, async () => {
    if (options.terminal === "hang") {
      return await new Promise<never>(() => {});
    }
    return { exitCode: 0, signal: null };
  });
  app.onRequest(acp.methods.client.terminal.kill, async () => ({}));
  app.onRequest(acp.methods.client.terminal.release, async (request) => {
    harness.terminalReleases.push(request.params);
    return {};
  });

  const connection = app.connect(stream);
  const ctx = connection.agent;
  const init = await withTimeout(
    ctx.request(acp.methods.agent.initialize, {
      protocolVersion: 1,
      clientCapabilities: options.clientCapabilities ?? {},
    }),
    "initialize",
  );
  if (init.agentInfo?.name !== "tnt") {
    throw new Error(`Unexpected agent: ${JSON.stringify(init.agentInfo)}`);
  }

  const created = await withTimeout(
    ctx.request(acp.methods.agent.session.new, {
      cwd: project,
      mcpServers: options.mcpServers ?? [],
      additionalDirectories: options.additionalDirectories,
    }),
    "session/new",
  );
  harness.child = child;
  harness.connection = connection;
  harness.ctx = ctx;
  harness.init = init;
  harness.stderr = () => stderr;
  harness.close = async () => {
    connection.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await withTimeout(
        once(child, "exit").then(() => undefined),
        "child exit",
      );
    }
  };
  (harness as Harness & { sessionId: string }).sessionId = created.sessionId;
  return harness;
}

function sessionId(harness: Harness): string {
  return (harness as Harness & { sessionId: string }).sessionId;
}

async function prompt(
  harness: Harness,
  session: string,
  text: string,
): Promise<acp.PromptResponse> {
  return await withTimeout(
    harness.ctx.request(acp.methods.agent.session.prompt, {
      sessionId: session,
      prompt: [{ type: "text", text }],
    }),
    `prompt ${text}`,
  );
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  ms = 5_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) {
      throw new Error(`${label} did not happen within ${ms}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("E2E: ACP agent", () => {
  let context: CLITestContext;
  let mockServer: MockLLMServer | undefined;
  let harness: Harness | undefined;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (harness) {
      await harness.close().catch(() => harness?.child.kill("SIGKILL"));
      harness = undefined;
    }
    if (mockServer) {
      await cleanupMockLLMServer(mockServer);
      mockServer = undefined;
    }
    await cleanupTestContext(context);
  });

  async function setup(
    options: MockLLMServerOptions = {},
    harnessOptions: {
      clientCapabilities?: acp.ClientCapabilities;
      mcpServers?: acp.McpServer[];
      additionalDirectories?: string[];
      terminal?: "foreground" | "hang";
    } = {},
  ): Promise<{ project: string; harness: Harness }> {
    mockServer = await setupMockLLMTest(context, options);
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project, harnessOptions);
    return { project, harness };
  }

  it("runs a prompt and lists the session", async () => {
    const { project, harness: h } = await setup({ response: "pong" });
    const response = await prompt(h, sessionId(h), "Reply with pong");
    expect(response.stopReason).toBe("end_turn");
    expect(
      h.updates.some(
        (entry) =>
          entry.sessionId === sessionId(h) &&
          entry.update.sessionUpdate === "agent_message_chunk" &&
          entry.update.content.type === "text" &&
          entry.update.content.text.includes("pong"),
      ),
    ).toBe(true);

    const list = await h.ctx.request(acp.methods.agent.session.list, {
      cwd: project,
    });
    expect(list.sessions.map((entry) => entry.sessionId)).toContain(
      sessionId(h),
    );
  }, 60_000);

  it("keeps two sessions isolated and concurrent", async () => {
    const responseText = (promptText: string) =>
      promptText.includes("alpha") ? "alpha" : "beta";
    const { project, harness: h } = await setup({ response: responseText });
    const projectB = path.join(context.testDir, "project-b");
    await fs.mkdir(projectB, { recursive: true });
    const second = await h.ctx.request(acp.methods.agent.session.new, {
      cwd: projectB,
      mcpServers: [],
    });

    const [first, other] = await Promise.all([
      prompt(h, sessionId(h), "Reply with alpha"),
      prompt(h, second.sessionId, "Reply with beta"),
    ]);
    expect(first.stopReason).toBe("end_turn");
    expect(other.stopReason).toBe("end_turn");

    const textFor = (id: string) =>
      h.updates
        .flatMap((entry) => {
          if (entry.sessionId !== id) return [];
          if (entry.update.sessionUpdate !== "agent_message_chunk") return [];
          const content = entry.update.content;
          return content.type === "text" ? [content.text] : [];
        })
        .join("");
    expect(textFor(sessionId(h))).toContain("alpha");
    expect(textFor(second.sessionId)).toContain("beta");

    const listA = await h.ctx.request(acp.methods.agent.session.list, {
      cwd: project,
    });
    const listB = await h.ctx.request(acp.methods.agent.session.list, {
      cwd: projectB,
    });
    expect(listA.sessions.map((entry) => entry.sessionId)).toEqual([
      sessionId(h),
    ]);
    expect(listB.sessions.map((entry) => entry.sessionId)).toEqual([
      second.sessionId,
    ]);
  }, 60_000);

  it("loads, resumes and deletes a persisted session", async () => {
    const { project, harness: h } = await setup({ response: "persisted" });
    await prompt(h, sessionId(h), "Remember this");
    await h.ctx.request(acp.methods.agent.session.close, {
      sessionId: sessionId(h),
    });

    const before = h.updates.length;
    await h.ctx.request(acp.methods.agent.session.load, {
      sessionId: sessionId(h),
      cwd: project,
      mcpServers: [],
    });
    expect(h.updates.length).toBeGreaterThan(before);
    expect(
      h.updates.some(
        (entry) => entry.update.sessionUpdate === "user_message_chunk",
      ),
    ).toBe(true);

    await h.ctx.request(acp.methods.agent.session.close, {
      sessionId: sessionId(h),
    });
    const beforeResume = h.updates.length;
    await h.ctx.request(acp.methods.agent.session.resume, {
      sessionId: sessionId(h),
      cwd: project,
      mcpServers: [],
    });
    expect(h.updates.length).toBe(beforeResume);

    await h.ctx.request(acp.methods.agent.session.close, {
      sessionId: sessionId(h),
    });
    await h.ctx.request(acp.methods.agent.session.delete, {
      sessionId: sessionId(h),
    });
    const list = await h.ctx.request(acp.methods.agent.session.list, {
      cwd: project,
    });
    expect(list.sessions).toEqual([]);
  }, 60_000);

  it("bridges a permission request and streams tool lifecycle updates", async () => {
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const parsed = JSON.parse(body);
          const hasToolResult = parsed.messages?.some(
            (message: { role?: string }) => message.role === "tool",
          );
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          if (hasToolResult) {
            res.write(
              `data: {"choices":[{"delta":{"content":"tool finished"},"index":0}]}\n\n`,
            );
          } else {
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_acp","type":"function","function":{"name":"Write","arguments":"{\\"filepath\\":\\"acp-tool.txt\\",\\"content\\":\\"hello\\"}"}}]},"index":0}]}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project);

    const response = await prompt(
      harness,
      sessionId(harness),
      "Run the command",
    );
    expect(response.stopReason).toBe("end_turn");
    expect(harness.permissionRequests).toBe(1);
    expect(await fs.readFile(path.join(project, "acp-tool.txt"), "utf8")).toBe(
      "hello",
    );
    const started = harness.updates.find(
      (entry) => entry.update.sessionUpdate === "tool_call",
    );
    const finished = harness.updates.find(
      (entry) =>
        entry.update.sessionUpdate === "tool_call_update" &&
        entry.update.status === "completed",
    );
    expect(started).toBeDefined();
    expect(finished).toBeDefined();
    if (
      started?.update.sessionUpdate === "tool_call" &&
      finished?.update.sessionUpdate === "tool_call_update"
    ) {
      expect(finished.update.toolCallId).toBe(started.update.toolCallId);
    }
  }, 60_000);

  it("routes reads and writes through the client's file service", async () => {
    const requests: any[] = [];
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const parsed = JSON.parse(body);
          requests.push(parsed);
          const toolMessages =
            parsed.messages?.filter(
              (message: { role?: string }) => message.role === "tool",
            ) ?? [];
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          if (toolMessages.length === 0) {
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read_virtual","type":"function","function":{"name":"Read","arguments":"{\\"filepath\\":\\"virtual.txt\\"}"}}]},"index":0}]}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          } else if (toolMessages.length === 1) {
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"write_virtual","type":"function","function":{"name":"Write","arguments":"{\\"filepath\\":\\"virtual.txt\\",\\"content\\":\\"from-model\\"}"}}]},"index":0}]}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          } else {
            res.write(
              `data: {"choices":[{"delta":{"content":"done"},"index":0}]}\n\n`,
            );
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project, {
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });

    const response = await prompt(
      harness,
      sessionId(harness),
      "Read then write virtual.txt",
    );
    expect(response.stopReason).toBe("end_turn");
    expect(harness.fsReads.length).toBeGreaterThanOrEqual(1);
    expect(harness.fsReads[0]?.path).toBe(path.join(project, "virtual.txt"));
    expect(harness.fsWrites).toHaveLength(1);
    expect(harness.fsWrites[0]).toMatchObject({
      path: path.join(project, "virtual.txt"),
      content: "from-model",
    });
    expect(harness.permissionRequests).toBeGreaterThanOrEqual(1);
    expect(
      requests[1]?.messages?.some(
        (message: any) =>
          message.role === "tool" &&
          String(message.content).includes("from-editor"),
      ),
    ).toBe(true);
    // The editor owned the write; no saved copy appeared on disk.
    expect(
      await fs
        .access(path.join(project, "virtual.txt"))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  }, 60_000);

  it("applies an ApplyPatch to the client's buffer", async () => {
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const parsed = JSON.parse(body);
          const toolMessages = parsed.messages?.filter(
            (message: { role?: string }) => message.role === "tool",
          );
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          if ((toolMessages?.length ?? 0) === 0) {
            res.write(
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "patch_virtual",
                          type: "function",
                          function: {
                            name: "ApplyPatch",
                            arguments: JSON.stringify({
                              patch: [
                                "*** Begin Patch",
                                "*** Update File: acp-patch.txt",
                                "-from-editor",
                                "+patched-from-editor",
                                "*** End Patch",
                              ].join("\n"),
                            }),
                          },
                        },
                      ],
                    },
                    index: 0,
                  },
                ],
              })}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          } else {
            res.write(
              `data: {"choices":[{"delta":{"content":"done"},"index":0}]}\n\n`,
            );
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project, {
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });

    const response = await prompt(
      harness,
      sessionId(harness),
      "Patch the virtual file",
    );

    expect(response.stopReason).toBe("end_turn");
    expect(harness.fsWrites).toHaveLength(1);
    expect(harness.fsWrites[0]).toMatchObject({
      path: path.join(project, "acp-patch.txt"),
      content: "patched-from-editor\n",
    });
    expect(
      await fs
        .access(path.join(project, "acp-patch.txt"))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  }, 60_000);

  it("connects ACP session MCP servers before the first prompt", async () => {
    const requests: any[] = [];
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          requests.push(JSON.parse(body));
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(
            `data: {"choices":[{"delta":{"content":"done"},"index":0}]}\n\n`,
          );
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    const fixture = path.join(project, "fixture-mcp.mjs");
    await fs.writeFile(
      fixture,
      `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: {} } }],
}));
await server.connect(new StdioServerTransport());
`,
      "utf-8",
    );
    await fs.symlink(
      path.resolve("node_modules"),
      path.join(project, "node_modules"),
      "dir",
    );
    harness = await startHarness(context, project, {
      mcpServers: [
        {
          name: "fixture",
          command: process.execPath,
          args: [fixture],
          env: [],
        },
      ],
    });

    const response = await prompt(harness, sessionId(harness), "Use the tool");
    expect(response.stopReason).toBe("end_turn");
    const tools = requests[0]?.tools ?? [];
    expect(
      tools.some(
        (tool: { function?: { name?: string } }) =>
          tool.function?.name === "mcp__fixture__echo",
      ),
    ).toBe(true);
  }, 60_000);

  it("runs foreground Bash through the client's terminal", async () => {
    const requests: any[] = [];
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const parsed = JSON.parse(body);
          requests.push(parsed);
          const toolMessages =
            parsed.messages?.filter(
              (message: { role?: string }) => message.role === "tool",
            ) ?? [];
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          if (toolMessages.length === 0) {
            res.write(
              `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"bash_terminal","type":"function","function":{"name":"Bash","arguments":"{\\"command\\":\\"echo routed\\"}"}}]},"index":0}]}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          } else {
            res.write(
              `data: {"choices":[{"delta":{"content":"done"},"index":0}]}\n\n`,
            );
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project, {
      clientCapabilities: { terminal: true },
    });

    const response = await prompt(harness, sessionId(harness), "Run it");
    expect(response.stopReason).toBe("end_turn");
    expect(harness.terminalCreates).toHaveLength(1);
    expect(harness.terminalCreates[0]?.cwd).toBe(project);
    expect(harness.terminalCreates[0]?.args?.join(" ")).toContain(
      "echo routed",
    );
    expect(harness.terminalReleases).toHaveLength(1);
    expect(
      requests[1]?.messages?.some(
        (message: any) =>
          message.role === "tool" &&
          String(message.content).includes("client-terminal-output"),
      ),
    ).toBe(true);
  }, 60_000);

  it("turns a timed-out client terminal into a pollable background job", async () => {
    const requests: any[] = [];
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const parsed = JSON.parse(body);
          requests.push(parsed);
          const toolMessages =
            parsed.messages?.filter(
              (message: { role?: string }) => message.role === "tool",
            ) ?? [];
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          if (toolMessages.length === 0) {
            res.write(
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "bash_background",
                          type: "function",
                          function: {
                            name: "Bash",
                            arguments: JSON.stringify({
                              command: "npm run dev",
                              timeout: 1,
                            }),
                          },
                        },
                      ],
                    },
                    index: 0,
                  },
                ],
              })}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          } else if (toolMessages.length === 1) {
            const jobId = /Job ID: (bg-\S+)/.exec(
              String(toolMessages[0].content),
            )?.[1];
            if (jobId) {
              res.write(
                `data: ${JSON.stringify({
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: "check_background",
                            type: "function",
                            function: {
                              name: "CheckBackgroundJob",
                              arguments: JSON.stringify({ job_id: jobId }),
                            },
                          },
                        ],
                      },
                      index: 0,
                    },
                  ],
                })}\n\n`,
              );
              res.write(
                `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
              );
            } else {
              res.write(
                `data: {"choices":[{"delta":{"content":"missing job id"},"index":0}]}\n\n`,
              );
            }
          } else {
            res.write(
              `data: {"choices":[{"delta":{"content":"background checked"},"index":0}]}\n\n`,
            );
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project, {
      clientCapabilities: { terminal: true },
      terminal: "hang",
    });

    const response = await prompt(harness, sessionId(harness), "Start it");
    expect(response.stopReason).toBe("end_turn");
    expect(harness.terminalCreates).toHaveLength(1);
    expect(harness.terminalReleases).toHaveLength(1);

    const checked = requests
      .flatMap((request) => request.messages ?? [])
      .filter(
        (message: { role?: string; content?: unknown }) =>
          message.role === "tool" &&
          String(message.content).includes("bg-done"),
      );
    expect(checked.length).toBeGreaterThan(0);
    expect(String(checked[0].content)).toContain('"status": "completed"');
  }, 60_000);

  it("treats additionalDirectories as workspace roots", async () => {
    const extra = path.join(context.testDir, "extra-root");
    await fs.mkdir(extra, { recursive: true });
    const target = path.join(extra, "outside.txt");
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const parsed = JSON.parse(body);
          const hasToolResult = parsed.messages?.some(
            (message: { role?: string }) => message.role === "tool",
          );
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          if (hasToolResult) {
            res.write(
              `data: {"choices":[{"delta":{"content":"done"},"index":0}]}\n\n`,
            );
          } else {
            const args = JSON.stringify({
              filepath: target,
              content: "outside-ok",
            });
            const chunk = {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "write_extra",
                        type: "function",
                        function: { name: "Write", arguments: args },
                      },
                    ],
                  },
                  index: 0,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project, {
      additionalDirectories: [extra],
    });

    await harness.ctx.request(acp.methods.agent.session.setMode, {
      sessionId: sessionId(harness),
      modeId: "acceptEdits",
    });
    const response = await prompt(
      harness,
      sessionId(harness),
      "Write into the extra root",
    );
    expect(response.stopReason).toBe("end_turn");
    expect(await fs.readFile(target, "utf8")).toBe("outside-ok");
    // acceptEdits allows writes inside a workspace root without asking; the
    // extra root has to count as one or this would have opened a prompt.
    expect(harness.permissionRequests).toBe(0);
  }, 60_000);

  it("accepts an image prompt and sends it as image content", async () => {
    const requests: any[] = [];
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          requests.push(JSON.parse(body));
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(
            `data: {"choices":[{"delta":{"content":"seen"},"index":0}]}\n\n`,
          );
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project);
    expect(harness.init.agentCapabilities?.promptCapabilities?.image).toBe(
      true,
    );

    const response = await withTimeout(
      harness.ctx.request(acp.methods.agent.session.prompt, {
        sessionId: sessionId(harness),
        prompt: [
          {
            type: "image",
            data: "aGVsbG8=",
            mimeType: "image/png",
          },
        ],
      }),
      "image prompt",
    );
    expect(response.stopReason).toBe("end_turn");
    const userMessage = requests[0]?.messages
      ?.filter((message: any) => message.role === "user")
      .at(-1);
    expect(Array.isArray(userMessage?.content)).toBe(true);
    expect(
      userMessage.content.some(
        (part: any) =>
          part.type === "image_url" &&
          String(part.image_url?.url).startsWith(
            "data:image/png;base64,aGVsbG8=",
          ),
      ),
    ).toBe(true);

    await harness.ctx.request(acp.methods.agent.session.close, {
      sessionId: sessionId(harness),
    });
    const before = harness.updates.length;
    await harness.ctx.request(acp.methods.agent.session.load, {
      sessionId: sessionId(harness),
      cwd: project,
      mcpServers: [],
    });
    expect(
      harness.updates
        .slice(before)
        .some(
          (entry) =>
            entry.update.sessionUpdate === "user_message_chunk" &&
            entry.update.content.type === "image",
        ),
    ).toBe(true);
  }, 60_000);

  it("accepts an audio prompt and sends it as audio content", async () => {
    const requests: any[] = [];
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          requests.push(JSON.parse(body));
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(
            `data: {"choices":[{"delta":{"content":"heard"},"index":0}]}\n\n`,
          );
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project);
    expect(harness.init.agentCapabilities?.promptCapabilities?.audio).toBe(
      true,
    );

    const response = await withTimeout(
      harness.ctx.request(acp.methods.agent.session.prompt, {
        sessionId: sessionId(harness),
        prompt: [
          {
            type: "audio",
            data: "UklGRg==",
            mimeType: "audio/wav",
          },
        ],
      }),
      "audio prompt",
    );
    expect(response.stopReason).toBe("end_turn");
    const userMessage = requests[0]?.messages
      ?.filter((message: any) => message.role === "user")
      .at(-1);
    expect(Array.isArray(userMessage?.content)).toBe(true);
    expect(
      userMessage.content.some(
        (part: any) =>
          part.type === "input_audio" &&
          part.input_audio?.data === "UklGRg==" &&
          part.input_audio?.format === "wav",
      ),
    ).toBe(true);

    await harness.ctx.request(acp.methods.agent.session.close, {
      sessionId: sessionId(harness),
    });
    const before = harness.updates.length;
    await harness.ctx.request(acp.methods.agent.session.load, {
      sessionId: sessionId(harness),
      cwd: project,
      mcpServers: [],
    });
    expect(
      harness.updates
        .slice(before)
        .some(
          (entry) =>
            entry.update.sessionUpdate === "user_message_chunk" &&
            entry.update.content.type === "audio",
        ),
    ).toBe(true);
  }, 60_000);

  it("reports context usage after a prompt", async () => {
    const { harness: h } = await setup({
      response: "pong",
      usage: { prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230 },
    });

    await prompt(h, sessionId(h), "Reply with pong");

    const usage = h.updates.find(
      (entry) => entry.update.sessionUpdate === "usage_update",
    );
    expect(usage).toBeDefined();
    if (usage?.update.sessionUpdate === "usage_update") {
      expect(usage.update.used).toBeGreaterThan(0);
      expect(usage.update.size).toBe(200_000);
      if (usage.update.cost) {
        expect(usage.update.cost.currency).toBe("USD");
        expect(usage.update.cost.amount).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it("streams Todo state as an ACP plan and replays it on load", async () => {
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const parsed = JSON.parse(body);
          const hasToolResult = parsed.messages?.some(
            (message: { role?: string }) => message.role === "tool",
          );
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          if (hasToolResult) {
            res.write(
              `data: {"choices":[{"delta":{"content":"todo recorded"},"index":0}]}\n\n`,
            );
          } else {
            res.write(
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_todo",
                          type: "function",
                          function: {
                            name: "Todo",
                            arguments: JSON.stringify({
                              action: "add",
                              text: "ship the ACP plan",
                            }),
                          },
                        },
                      ],
                    },
                    index: 0,
                  },
                ],
              })}\n\n`,
            );
            res.write(
              `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"index":0}\n\n`,
            );
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project);

    await prompt(harness, sessionId(harness), "Track this work");

    const plan = harness.updates.find(
      (entry) => entry.update.sessionUpdate === "plan",
    );
    expect(plan).toBeDefined();
    if (plan?.update.sessionUpdate === "plan") {
      expect(plan.update.entries).toEqual([
        {
          content: "ship the ACP plan",
          priority: "medium",
          status: "pending",
        },
      ]);
    }

    await harness.ctx.request(acp.methods.agent.session.close, {
      sessionId: sessionId(harness),
    });
    const before = harness.updates.length;
    await harness.ctx.request(acp.methods.agent.session.load, {
      sessionId: sessionId(harness),
      cwd: project,
      mcpServers: [],
    });
    expect(
      harness.updates
        .slice(before)
        .some((entry) => entry.update.sessionUpdate === "plan"),
    ).toBe(true);
  }, 60_000);

  it("stops a turn on session/cancel", async () => {
    mockServer = await setupMockLLMTest(context, {
      customHandler: (req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          if (req.method !== "POST" || req.url !== "/chat/completions") {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          let count = 0;
          const timer = setInterval(() => {
            if (res.writableEnded) return;
            count += 1;
            try {
              res.write(
                `data: {"choices":[{"delta":{"content":"chunk-${count} "},"index":0}]}\n\n`,
              );
            } catch {
              clearInterval(timer);
            }
            if (count >= 20) {
              clearInterval(timer);
              res.write(`data: [DONE]\n\n`);
              res.end();
            }
          }, 100);
          res.on("close", () => clearInterval(timer));
        });
      },
    });
    const project = path.join(context.testDir, "project");
    await fs.mkdir(project, { recursive: true });
    harness = await startHarness(context, project);

    const pending = harness.ctx.request(acp.methods.agent.session.prompt, {
      sessionId: sessionId(harness),
      prompt: [{ type: "text", text: "Write a long answer" }],
    });
    await waitFor(
      () =>
        harness!.updates.some(
          (entry) => entry.update.sessionUpdate === "agent_message_chunk",
        ),
      "first streamed chunk",
    );
    await harness.ctx.notify(acp.methods.agent.session.cancel, {
      sessionId: sessionId(harness),
    });

    const response = await withTimeout(pending, "prompt after cancel", 10_000);
    expect(response.stopReason).toBe("cancelled");
  }, 60_000);
});
