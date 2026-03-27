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
          name: "reclaim-me",
          description: "a tool on a server nobody called yet",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }),
  ),
  callTool: vi.fn(() => Promise.resolve({})),
  close: vi.fn(() => Promise.resolve()),
};

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(() => mockClient),
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(),
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

const beat = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The service marks a server connected before `listTools` has answered, so a
 * test that is about to call a tool has to wait for both halves.
 */
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
    name: "idle reclaim",
    version: "1.0.0",
    mcpServers: [{ name: "srv", command: "node", args: ["-e", "0"], env: {} }],
  } as unknown as AssistantConfig;
}

/**
 * An MCP server costs a process for as long as it is connected, while a session
 * may never call it. Releasing the idle ones is only safe if the model still
 * sees what they offer - these cases pin both halves: the process goes, the
 * tool stays listed, and the next call brings the server back.
 */
describe("MCP idle reclaim", () => {
  let service: MCPService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MCPService();
  });

  afterEach(async () => {
    await service.cleanup();
    vi.unstubAllEnvs();
  });

  it("releases an idle server but keeps advertising its tools", async () => {
    vi.stubEnv("TNT_MCP_IDLE_TIMEOUT_MS", "50");

    await service.initialize(assistantWithServer());
    // `initialize` does not await the connects in interactive mode, so every
    // case below waits for the state it is about to reason about.
    expect(await until(() => ready(service))).toBe(true);

    expect(
      await until(() => service.getState().connections[0].status === "idle"),
    ).toBe(true);

    expect(mockClient.close).toHaveBeenCalled();
    // The point of the test: releasing the process must not remove capability
    // the model was already told about.
    expect(service.getState().tools.map((t) => t.name)).toContain("reclaim-me");
  });

  it("reconnects on the call that needed the reclaimed server", async () => {
    vi.stubEnv("TNT_MCP_IDLE_TIMEOUT_MS", "50");

    await service.initialize(assistantWithServer());
    expect(
      await until(() => service.getState().connections[0].status === "idle"),
    ).toBe(true);
    const connectsBefore = mockClient.connect.mock.calls.length;

    await service.runTool("reclaim-me", {}, "srv");

    expect(mockClient.connect.mock.calls.length).toBeGreaterThan(
      connectsBefore,
    );
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: "reclaim-me",
      arguments: {},
    });
    expect(service.getState().connections[0].status).toBe("connected");
  });

  it("leaves a server alone while a call is in flight", async () => {
    vi.stubEnv("TNT_MCP_IDLE_TIMEOUT_MS", "80");

    let release: () => void = () => {};
    mockClient.callTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    );

    await service.initialize(assistantWithServer());
    expect(await until(() => ready(service))).toBe(true);
    const running = service.runTool("reclaim-me", {}, "srv");
    // Give the call time to register as in flight, then outlive the window.
    await beat(30);
    await beat(200);

    expect(mockClient.close).not.toHaveBeenCalled();
    expect(service.getState().connections[0].status).toBe("connected");

    release();
    await expect(running).resolves.toBeDefined();
  });

  it("does not reach for a server whose close is still hanging", async () => {
    vi.stubEnv("TNT_MCP_IDLE_TIMEOUT_MS", "30");

    let finishClose: () => void = () => {};
    mockClient.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishClose = () => resolve();
        }),
    );

    await service.initialize(assistantWithServer());
    expect(await until(() => ready(service))).toBe(true);

    // A 30 ms window means a sweep every 25 ms: an unguarded sweep would pick
    // the same connection up again repeatedly while the close hangs, and killing
    // a process that is already being released is how a reclaim eats a call.
    await beat(250);
    expect(mockClient.close.mock.calls.length).toBe(1);
    expect(service.getState().connections[0].status).toBe("connected");

    finishClose();
    expect(
      await until(() => service.getState().connections[0].status === "idle"),
    ).toBe(true);
  });

  it("keeps every server when the window is zero", async () => {
    vi.stubEnv("TNT_MCP_IDLE_TIMEOUT_MS", "0");

    await service.initialize(assistantWithServer());
    await beat(200);

    expect(mockClient.close).not.toHaveBeenCalled();
    expect(service.getState().connections[0].status).toBe("connected");
  });

  it("clears the tool list on a full teardown, so a removed server cannot linger", async () => {
    vi.stubEnv("TNT_MCP_IDLE_TIMEOUT_MS", "50");

    await service.initialize(assistantWithServer());
    expect(
      await until(() => service.getState().connections[0].status === "idle"),
    ).toBe(true);
    expect(service.getState().tools.length).toBe(1);

    await service.shutdownConnections();
    expect(service.getState().tools.length).toBe(0);
  });
});
