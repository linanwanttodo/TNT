import { describe, expect, it } from "vitest";

import type { MCPConnectionInfo } from "../../services/types.js";

import { collectFailedMcpServerNames } from "./mcpFailures.js";

function connection(
  name: string,
  status: MCPConnectionInfo["status"],
): MCPConnectionInfo {
  return {
    config: { name } as MCPConnectionInfo["config"],
    status,
    tools: [],
    prompts: [],
    warnings: [],
  };
}

describe("collectFailedMcpServerNames", () => {
  it("returns nothing when no connection is defined", () => {
    expect(collectFailedMcpServerNames(undefined)).toEqual([]);
  });

  it("returns nothing when every server connected", () => {
    const connections = [
      connection("alpha", "connected"),
      connection("beta", "connecting"),
    ];

    expect(collectFailedMcpServerNames(connections)).toEqual([]);
  });

  it("returns the names of servers that failed", () => {
    const connections = [
      connection("alpha", "connected"),
      connection("beta", "error"),
      connection("gamma", "error"),
    ];

    expect(collectFailedMcpServerNames(connections)).toEqual(["beta", "gamma"]);
  });

  it("falls back to a placeholder when a failed server has no name", () => {
    const connections: MCPConnectionInfo[] = [
      {
        config: {} as MCPConnectionInfo["config"],
        status: "error",
        tools: [],
        prompts: [],
        warnings: [],
      },
    ];

    expect(collectFailedMcpServerNames(connections)).toEqual(["unknown"]);
  });
});
