import type * as acp from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";

import { BackgroundJobService } from "../services/BackgroundJobService.js";

import { createAcpTerminalRunner } from "./terminal.js";

function clientWith(responses: Record<string, unknown>): {
  client: acp.AgentContext;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async (method: string) => {
    const response = responses[method];
    if (typeof response === "function") return response();
    if (response === undefined) throw new Error(`unexpected ${method}`);
    return response;
  });
  return { client: { request } as unknown as acp.AgentContext, request };
}

describe("ACP terminal runner", () => {
  it("creates, waits, reads and releases one terminal", async () => {
    const { client, request } = clientWith({
      "terminal/create": { terminalId: "terminal-1" },
      "terminal/wait_for_exit": { exitCode: 0, signal: null },
      "terminal/output": { output: "hello\n", truncated: false },
      "terminal/release": {},
    });

    const runner = createAcpTerminalRunner(client, "session-1");
    const result = await runner.run({
      shell: "/bin/bash",
      args: ["-lc", "echo hello"],
      cwd: "/tmp",
      timeoutMs: 5_000,
    });

    expect(result).toEqual({
      output: "hello\n",
      exitCode: 0,
      signal: null,
      timedOut: false,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "terminal/create",
      expect.objectContaining({
        sessionId: "session-1",
        command: "/bin/bash",
        args: ["-lc", "echo hello"],
        cwd: "/tmp",
      }),
      expect.any(Object),
    );
    const methods = request.mock.calls.map((call) => call[0]);
    expect(methods).toEqual([
      "terminal/create",
      "terminal/wait_for_exit",
      "terminal/output",
      "terminal/release",
    ]);
  });

  it("keeps a timed-out terminal alive as a pollable background job", async () => {
    const outputs = [
      { output: "partial\n", truncated: false },
      {
        output: "partial\nmore\n",
        truncated: false,
        exitStatus: { exitCode: 0, signal: null },
      },
    ];
    const { client, request } = clientWith({
      "terminal/create": { terminalId: "terminal-2" },
      "terminal/wait_for_exit": () => new Promise(() => {}),
      "terminal/output": () => outputs.shift(),
      "terminal/kill": {},
      "terminal/release": {},
    });
    const jobs = new BackgroundJobService();
    const runner = createAcpTerminalRunner(client, "session-1", { jobs });

    const result = await runner.run({
      shell: "/bin/bash",
      args: ["-lc", "npm run dev"],
      cwd: "/tmp",
      timeoutMs: 10,
    });

    expect(result).toMatchObject({
      output: "partial\n",
      timedOut: true,
    });
    expect(result.backgroundJobId).toBeTruthy();
    let methods = request.mock.calls.map((call) => call[0]);
    expect(methods).not.toContain("terminal/kill");
    expect(methods).not.toContain("terminal/release");

    const job = await jobs.refreshJob(result.backgroundJobId!);
    expect(job).toMatchObject({
      status: "completed",
      output: "partial\nmore\n",
      exitCode: 0,
    });
    methods = request.mock.calls.map((call) => call[0]);
    expect(methods).toContain("terminal/release");
  });

  it("cancels and releases background terminals on dispose", async () => {
    const { client, request } = clientWith({
      "terminal/create": { terminalId: "terminal-3" },
      "terminal/wait_for_exit": () => new Promise(() => {}),
      "terminal/output": { output: "waiting\n", truncated: false },
      "terminal/kill": {},
      "terminal/release": {},
    });
    const jobs = new BackgroundJobService();
    const runner = createAcpTerminalRunner(client, "session-1", { jobs });

    const result = await runner.run({
      shell: "/bin/bash",
      args: ["-lc", "read answer"],
      cwd: "/tmp",
      timeoutMs: 10,
    });
    await runner.dispose?.();

    const methods = request.mock.calls.map((call) => call[0]);
    expect(methods).toContain("terminal/kill");
    expect(methods).toContain("terminal/release");
    expect(jobs.getJob(result.backgroundJobId!)?.status).toBe("cancelled");
  });
});
