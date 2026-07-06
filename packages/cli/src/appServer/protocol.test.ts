import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NdjsonTransport } from "./transport.js";

const CLI_PATH = fileURLToPath(new URL("../../dist/tnt.js", import.meta.url));
const WAIT_MS = 15000;

interface LineWaiter {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class LineQueue {
  private buffer = "";
  private readonly buffered: string[] = [];
  private readonly waiters: LineWaiter[] = [];
  private failure: Error | null = null;
  private readonly finished: Promise<void>;
  private resolveFinished: () => void = () => undefined;

  constructor(
    stream: Readable,
    private readonly details: () => string = () => "",
  ) {
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => this.onData(chunk));
    stream.on("error", (error: Error) => this.fail(error));
    stream.on("end", () => {
      if (this.buffer.trim().length > 0) {
        this.deliver(this.buffer.replace(/\r$/, ""));
        this.buffer = "";
      }
      this.fail(new Error("stdout closed"));
      this.resolveFinished();
    });
  }

  next(timeoutMs: number = WAIT_MS): Promise<string> {
    const line = this.buffered.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      const waiter: LineWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(
            new Error(
              this.contextualize("Timed out waiting for an NDJSON line"),
            ),
          );
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  contextualize(message: string): string {
    const details = this.details().trim();
    return details.length > 0
      ? `${message}\nchild stderr:\n${details}`
      : message;
  }

  async remainingLines(): Promise<string[]> {
    await this.finished;
    return [...this.buffered];
  }

  close(): void {
    this.fail(new Error("test disposed the line queue"));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim().length > 0) {
        this.deliver(line);
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  private deliver(line: string): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.buffered.push(line);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(line);
  }

  private fail(error: Error): void {
    if (this.failure) {
      return;
    }
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private removeWaiter(target: LineWaiter): void {
    const index = this.waiters.indexOf(target);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }
}

async function nextJson(queue: LineQueue): Promise<Record<string, unknown>> {
  const line = await queue.next();
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new Error(queue.contextualize(`stdout line is not JSON: ${line}`));
  }
}

function send(
  child: ChildProcessWithoutNullStreams,
  message: Record<string, unknown>,
): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  details: () => string = () => "",
  timeoutMs: number = WAIT_MS,
): Promise<number | null> {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const stderr = details().trim();
      reject(
        new Error(
          stderr.length > 0
            ? `child process did not exit\nchild stderr:\n${stderr}`
            : "child process did not exit",
        ),
      );
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("app-server stdio protocol", () => {
  let fixtureCwd: string;
  let child: ChildProcessWithoutNullStreams;
  let queue: LineQueue;
  let childStderr: string;

  const stderrDetails = (): string => childStderr;

  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `Missing ${CLI_PATH}. Run \`npm run build:bundle\` before this suite.`,
      );
    }
  });

  beforeEach(() => {
    fixtureCwd = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-app-server-"));
    childStderr = "";
    child = spawn(process.execPath, [CLI_PATH, "app-server", "--stdio"], {
      cwd: fixtureCwd,
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      childStderr += chunk;
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        return;
      }
      childStderr += `stdin error: ${error.message}\n`;
    });
    queue = new LineQueue(child.stdout, stderrDetails);
  });

  afterEach(async () => {
    queue.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, stderrDetails, 5000).catch(() => undefined);
    }
    fs.rmSync(fixtureCwd, { recursive: true, force: true });
  });

  it("round-trips runtime/capabilities with the request id", async () => {
    send(child, { id: 1, method: "runtime/capabilities", params: {} });

    const response = await nextJson(queue);

    expect(response.id).toBe(1);
    expect(response.result).toMatchObject({
      version: expect.any(Number),
      capabilities: { version: expect.any(Number) },
    });
  });

  it("reports the lifecycle state and the process cwd", async () => {
    send(child, {
      id: "state",
      method: "session/lifecycle/getState",
      params: {},
    });

    const response = await nextJson(queue);

    expect(response).toEqual({
      id: "state",
      result: { state: "available", cwd: fs.realpathSync(fixtureCwd) },
    });
  });

  it("answers an unknown method with method-not-found", async () => {
    send(child, { id: 2, method: "session/does-not-exist", params: {} });

    const response = await nextJson(queue);

    expect(response).toEqual({
      id: 2,
      error: {
        code: -32601,
        message: "Method not found: session/does-not-exist",
      },
    });
  });

  it("reports a malformed line and keeps serving", async () => {
    child.stdin.write("this is not json\n");

    const malformed = await nextJson(queue);
    expect(malformed).toMatchObject({
      id: null,
      error: { code: -32700 },
    });

    send(child, { id: 3, method: "runtime/capabilities", params: {} });
    const response = await nextJson(queue);
    expect(response.id).toBe(3);
    expect(response.result).toBeDefined();
  });

  it("does not answer a notification that carries no id", async () => {
    send(child, { method: "runtime/capabilities", params: {} });
    send(child, { id: 4, method: "runtime/capabilities", params: {} });

    const response = await nextJson(queue);

    expect(response.id).toBe(4);
  });

  it("exits after stdin closes and reports the stopping lifecycle", async () => {
    child.stdin.end();

    const notification = await nextJson(queue);
    expect(notification).toEqual({
      method: "session/lifecycle/changed",
      params: { state: "stopping", cwd: fs.realpathSync(fixtureCwd) },
    });
    await expect(waitForExit(child, stderrDetails)).resolves.toBe(0);
  });

  it("answers a request that arrives with stdin end before shutting down", async () => {
    child.stdin.end(
      `${JSON.stringify({
        id: "tail",
        method: "runtime/capabilities",
        params: {},
      })}\n`,
    );

    const response = await nextJson(queue);
    expect(response.id).toBe("tail");
    expect(response.result).toBeDefined();

    const notification = await nextJson(queue);
    expect(notification.method).toBe("session/lifecycle/changed");
    await expect(waitForExit(child, stderrDetails)).resolves.toBe(0);
  });

  it("emits session/lifecycle/changed on SIGTERM before exiting", async () => {
    send(child, { id: 5, method: "runtime/capabilities", params: {} });
    await nextJson(queue);

    child.kill("SIGTERM");

    const notification = await nextJson(queue);
    expect(notification).toEqual({
      method: "session/lifecycle/changed",
      params: { state: "stopping", cwd: fs.realpathSync(fixtureCwd) },
    });
    await expect(waitForExit(child, stderrDetails)).resolves.toBe(0);
  });

  it("emits session/lifecycle/changed on SIGINT before exiting", async () => {
    send(child, { id: 6, method: "runtime/capabilities", params: {} });
    await nextJson(queue);

    child.kill("SIGINT");

    const notification = await nextJson(queue);
    expect(notification).toEqual({
      method: "session/lifecycle/changed",
      params: { state: "stopping", cwd: fs.realpathSync(fixtureCwd) },
    });
    await expect(waitForExit(child, stderrDetails)).resolves.toBe(0);
  });

  it("emits exactly one lifecycle notification when stdin end and a signal race", async () => {
    send(child, { id: 7, method: "runtime/capabilities", params: {} });
    await nextJson(queue);

    child.kill("SIGINT");
    child.stdin.end();

    const notification = await nextJson(queue);
    expect(notification.method).toBe("session/lifecycle/changed");

    await expect(waitForExit(child, stderrDetails)).resolves.toBe(0);
    await expect(queue.remainingLines()).resolves.toEqual([]);
  });

  it("exits on a repeated signal without waiting for shutdown", async () => {
    send(child, { id: 8, method: "runtime/capabilities", params: {} });
    await nextJson(queue);

    child.kill("SIGTERM");
    child.kill("SIGINT");

    await expect(waitForExit(child, stderrDetails)).resolves.toBe(0);
  });
});

describe("NdjsonTransport", () => {
  it("caps an oversized line and keeps reading the next one", () => {
    const input = new PassThrough();
    const transport = new NdjsonTransport({
      input,
      output: new PassThrough(),
      maxLineBytes: 8,
    });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.start({
      onMessage: (message) => messages.push(message),
      onLineError: (error) => errors.push(error),
      onEnd: () => undefined,
    });

    input.write('123456789\n{"a":1}\n');

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("exceeds 8 bytes");
    expect(messages).toEqual([{ a: 1 }]);
    transport.stop();
  });
});
