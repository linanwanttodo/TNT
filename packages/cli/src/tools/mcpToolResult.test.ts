import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { ChatHistoryItem } from "core/index.js";
import { checkToolPermission } from "../permissions/permissionChecker.js";
import { services } from "../services/index.js";
import type { MCPConnectionInfo, MCPTool } from "../services/types.js";
import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";
import {
  clearMcpSharedTools,
  convertMcpToolToInternalTool,
  mcpToolsFromConnections,
} from "./mcp.js";
import { claimForToolCall } from "./specs/concurrency.js";

let previousGlobalDir: string | undefined;
let testRoot: string;
const originalBuiltIns = [...ALL_BUILT_IN_TOOLS];

function mcpTool(overrides: Partial<MCPTool> = {}): MCPTool {
  return {
    name: "render_thing",
    description: "a tool the server offers",
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  } as MCPTool;
}

function server(name: string, tools: MCPTool[]): MCPConnectionInfo {
  return {
    config: { name },
    status: "connected",
    tools,
    prompts: [],
    warnings: [],
  } as unknown as MCPConnectionInfo;
}

/** Runs the converted tool the way the pipeline does. */
async function run(tool: ReturnType<typeof convertMcpToolToInternalTool>) {
  return await tool.run({}, { toolCallId: "call_1", parallelToolCallCount: 1 });
}

describe("MCP tool run result handling", () => {
  let runTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    previousGlobalDir = process.env.TNT_GLOBAL_DIR;
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-mcp-result-"));
    process.env.TNT_GLOBAL_DIR = testRoot;
    clearMcpSharedTools();
    runTool = vi.fn();
    (services as any).mcp = { runTool };
  });

  afterEach(async () => {
    (services as any).mcp = undefined;
    clearMcpSharedTools();
    fs.rmSync(testRoot, { recursive: true, force: true });
    if (previousGlobalDir === undefined) delete process.env.TNT_GLOBAL_DIR;
    else process.env.TNT_GLOBAL_DIR = previousGlobalDir;
  });

  it("throws on an isError result instead of recording its text", async () => {
    runTool.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "disk full on the server" }],
    });
    const tool = convertMcpToolToInternalTool(
      mcpTool(),
      "srv",
      "mcp__srv__render_thing",
    );

    await expect(run(tool)).rejects.toThrow(
      'MCP tool "render_thing" failed: disk full on the server',
    );
  });

  it("writes an image block to disk and keeps only the placeholder", async () => {
    // One pixel of PNG, base64.
    const data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";
    runTool.mockResolvedValue({
      content: [
        { type: "text", text: "screenshot attached" },
        { type: "image", data, mimeType: "image/png" },
      ],
    });
    // The image goes to the session's tool-results dir, which needs a session.
    const { createSession } = await import("../session/index.js");
    createSession([] as ChatHistoryItem[], "mcp-image-session");

    const tool = convertMcpToolToInternalTool(
      mcpTool(),
      "srv",
      "mcp__srv__render_thing",
    );
    const rendered = (await run(tool)) as string;

    expect(rendered).toContain("screenshot attached");
    const match = /\[image saved to (.+) \(image\/png\)\]/.exec(rendered);
    expect(match).not.toBeNull();
    expect(fs.existsSync(match![1])).toBe(true);
    // The base64 itself never reaches the conversation.
    expect(rendered).not.toContain(data);
  });

  it("replaces an image it cannot store with a failed-save placeholder", async () => {
    runTool.mockResolvedValue({
      content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
    });
    // Block the tool-results path with a file so the write fails; the model
    // must still get a readable placeholder, not the payload or a throw.
    const { createSession, getToolResultsDir } =
      await import("../session/index.js");
    createSession([] as ChatHistoryItem[], "mcp-fail-session");
    const dir = getToolResultsDir("mcp-fail-session");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, "not a directory");

    const tool = convertMcpToolToInternalTool(
      mcpTool(),
      "srv",
      "mcp__srv__render_thing",
    );
    const rendered = (await run(tool)) as string;

    expect(rendered).toBe("[image (image/png) could not be saved]");
  });

  it("renders a resource block as its uri and mime type", async () => {
    runTool.mockResolvedValue({
      content: [
        {
          type: "resource",
          resource: {
            uri: "file:///tmp/report.pdf",
            mimeType: "application/pdf",
          },
        },
      ],
    });

    const tool = convertMcpToolToInternalTool(
      mcpTool(),
      "srv",
      "mcp__srv__render_thing",
    );
    const rendered = (await run(tool)) as string;

    expect(rendered).toBe(
      "[resource file:///tmp/report.pdf (application/pdf)]",
    );
  });

  it("keeps passing plain text results through", async () => {
    runTool.mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
    });

    const tool = convertMcpToolToInternalTool(
      mcpTool(),
      "srv",
      "mcp__srv__render_thing",
    );
    expect(await run(tool)).toBe("hello");
  });
});

describe("annotations.readOnlyHint", () => {
  beforeEach(() => {
    clearMcpSharedTools();
  });

  afterEach(() => {
    clearMcpSharedTools();
    ALL_BUILT_IN_TOOLS.length = 0;
    ALL_BUILT_IN_TOOLS.push(...originalBuiltIns);
  });

  it("marks the converted tool readonly and registers it as shareable", () => {
    const hinted = convertMcpToolToInternalTool(
      mcpTool({ annotations: { readOnlyHint: true } }),
      "srv",
      "mcp__srv__read_only_thing",
    );
    const unhinted = convertMcpToolToInternalTool(
      mcpTool(),
      "srv",
      "mcp__srv__normal_thing",
    );

    expect(hinted.readonly).toBe(true);
    expect(unhinted.readonly).toBe(false);

    mcpToolsFromConnections([
      server("srv", [
        mcpTool({
          name: "read_only_thing",
          annotations: { readOnlyHint: true },
        }),
        mcpTool({ name: "normal_thing" }),
      ]),
    ]);

    expect(claimForToolCall("mcp__srv__read_only_thing", {})).toEqual({
      exclusive: false,
      keys: [],
    });
    // Without the hint the conservative exclusive slot stands.
    expect(claimForToolCall("mcp__srv__normal_thing", {})).toEqual({
      exclusive: true,
      keys: [],
    });
  });

  it("runs an allow rule through the read-only narrowing without escalation", () => {
    const hinted = convertMcpToolToInternalTool(
      mcpTool({ name: "read_only_thing", annotations: { readOnlyHint: true } }),
      "srv",
      "mcp__srv__read_only_thing",
    );
    // checkToolPermission looks tools up in the built-in registry; the test
    // borrows a slot so the narrowed path can see the converted tool.
    ALL_BUILT_IN_TOOLS.push(hinted);
    const permissions = {
      policies: [
        { tool: "mcp__srv__read_only_thing", permission: "allow" as const },
      ],
    };

    const result = checkToolPermission(
      { name: "mcp__srv__read_only_thing", arguments: {} },
      permissions,
    );

    // The narrowReadOnlyAllow fast path: a read-only tool whose evaluation
    // matches the base policy keeps its allow instead of being escalated.
    expect(result.permission).toBe("allow");

    const asked = checkToolPermission(
      { name: "mcp__srv__read_only_thing", arguments: {} },
      {
        policies: [
          { tool: "mcp__srv__read_only_thing", permission: "ask" as const },
        ],
      },
    );
    expect(asked.permission).toBe("ask");
  });
});
