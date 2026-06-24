import { AssistantConfig } from "@tnt/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MCPService } from "./MCPService.js";

const mockClient = {
  connect: vi.fn(),
  getServerCapabilities: vi.fn(() => ({ prompts: true, tools: true })),
  listPrompts: vi.fn(() => Promise.resolve({ prompts: [] })),
  listTools: vi.fn(() =>
    Promise.resolve({
      tools: [
        {
          name: "flaky",
          description: "a tool behind a server that blips",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }),
  ),
  callTool: vi.fn(() => Promise.resolve({ content: [] })),
  close: vi.fn(() => Promise.resolve()),
};

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(() => mockClient),
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));
// mcpUtils reads SseError/StreamableHTTPError from these modules for the
// transient classification, so the real exports stay and only the transports
// are stubbed.
vi.mock("@modelcontextprotocol/sdk/client/sse.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SSEClientTransport: vi.fn(),
}));
vi.mock(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    StreamableHTTPClientTransport: vi.fn(),
  }),
);

const beat = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

function ready(service: MCPService): boolean {
  const connection = service.getState().connections[0] as
    { status: string } | undefined;
  return (
    connection?.status === "connected" && service.getState().tools.length > 0
  );
}

async function until(want: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!want() && Date.now() < deadline) {
    await beat();
  }
  return want();
}

function assistantWithServer(): AssistantConfig {
  return {
    name: "transient retry",
    version: "1.0.0",
    mcpServers: [{ name: "srv", command: "node", args: ["-e", "0"], env: {} }],
  } as unknown as AssistantConfig;
}

/**
 * The wire options and the retry: every call carries the shared timeout and
 * progress reset, and a transient failure gets exactly one more try before
 * the error reaches the model.
 */
describe("MCP call options and transient retry", () => {
  let service: MCPService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TNT_MCP_RETRY_DELAY_MS", "1");
    service = new MCPService();
  });

  afterEach(async () => {
    await service.cleanup();
    vi.unstubAllEnvs();
  });

  it("passes timeout and resetTimeoutOnProgress on every SDK call", async () => {
    await service.initialize(assistantWithServer());
    expect(await until(() => ready(service))).toBe(true);

    await service.runTool("flaky", {}, "srv");

    const options = (mockClient.callTool as any).mock.calls[0][2];
    expect(options).toEqual({
      timeout: 600_000,
      resetTimeoutOnProgress: true,
    });
    // The connect and the listings get the same budget.
    expect(mockClient.connect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeout: 600_000,
        resetTimeoutOnProgress: true,
      }),
    );
    expect(mockClient.listTools).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        timeout: 600_000,
        resetTimeoutOnProgress: true,
      }),
    );
    expect(mockClient.listPrompts).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        timeout: 600_000,
        resetTimeoutOnProgress: true,
      }),
    );
  });

  it("succeeds without reporting after one transient failure", async () => {
    await service.initialize(assistantWithServer());
    expect(await until(() => ready(service))).toBe(true);

    mockClient.callTool
      .mockImplementationOnce(async () => {
        throw new Error("read ECONNRESET");
      })
      .mockImplementationOnce(
        async () =>
          ({
            content: [{ type: "text", text: "done" }],
          }) as any,
      );

    await expect(service.runTool("flaky", {}, "srv")).resolves.toEqual({
      content: [{ type: "text", text: "done" }],
    });
    expect(mockClient.callTool).toHaveBeenCalledTimes(2);
  });

  it("reports the failure when the retry fails too", async () => {
    await service.initialize(assistantWithServer());
    expect(await until(() => ready(service))).toBe(true);

    mockClient.callTool.mockImplementation(async () => {
      throw new Error("read ECONNRESET");
    });

    await expect(service.runTool("flaky", {}, "srv")).rejects.toThrow(
      "read ECONNRESET",
    );
    // Exactly one retry: two calls, then the error surfaces.
    expect(mockClient.callTool).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failure that no repeat could fix", async () => {
    await service.initialize(assistantWithServer());
    expect(await until(() => ready(service))).toBe(true);

    mockClient.callTool.mockImplementation(async () => {
      throw new Error("invalid arguments for tool");
    });

    await expect(service.runTool("flaky", {}, "srv")).rejects.toThrow(
      "invalid arguments for tool",
    );
    expect(mockClient.callTool).toHaveBeenCalledTimes(1);
  });
});
