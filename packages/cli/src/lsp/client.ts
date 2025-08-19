import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

/**
 * A plugin declares its language server as a command plus arguments. This is
 * the shape `loadPluginLspServers` already resolves, with
 * `${CLAUDE_PLUGIN_ROOT}` substituted.
 */
export interface LspServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  initializationOptions?: unknown;
}

export interface LspDiagnostic {
  message: string;
  severity?: number;
  source?: string;
  range?: unknown;
}

export interface LspClientOptions {
  /** Workspace root reported to the server. */
  rootPath: string;
  timeoutMs?: number;
  onDiagnostics?: (uri: string, diagnostics: LspDiagnostic[]) => void;
  /** Called when the server dies or reports a fatal problem. */
  onServerError?: (message: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export const DEFAULT_LSP_TIMEOUT_MS = 10_000;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function languageIdForPath(filePath: string): string {
  return (
    LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "plaintext"
  );
}

class LspProtocolError extends Error {}

/**
 * Minimal Language Server Protocol client over stdio: the subset needed to
 * start a plugin's server, tell it about a document, and collect the
 * diagnostics it publishes. Requests are correlated by id and reject on
 * timeout rather than hanging the caller.
 */
export class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly openDocuments = new Map<
    string,
    { text: string; languageId: string; version: number }
  >();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private disposed = false;
  private readonly timeoutMs: number;
  private readonly onDiagnostics?: LspClientOptions["onDiagnostics"];
  private readonly onServerError?: LspClientOptions["onServerError"];
  private stderrTail = "";

  private constructor(
    child: ChildProcessWithoutNullStreams,
    options: LspClientOptions,
  ) {
    this.child = child;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LSP_TIMEOUT_MS;
    this.onDiagnostics = options.onDiagnostics;
    this.onServerError = options.onServerError;
    this.wire();
  }

  static start(
    config: LspServerConfig,
    options: LspClientOptions,
  ): Promise<LspClient> {
    const client = new LspClient(
      spawn(config.command, config.args ?? [], {
        cwd: options.rootPath,
        env: { ...process.env, ...(config.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      }),
      options,
    );
    return client.handshake(config, options);
  }

  private wire(): void {
    this.child.stdout.on("data", (chunk: Buffer) => this.ingest(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2000);
    });
    this.child.on("error", (error) => {
      this.fail(`${error.message}`);
    });
    this.child.on("exit", (code, signal) => {
      if (this.disposed) return;
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this.fail(
        `language server exited (${detail})${this.stderrTail ? `: ${this.stderrTail.trim()}` : ""}`,
      );
    });
  }

  private async handshake(
    config: LspServerConfig,
    options: LspClientOptions,
  ): Promise<LspClient> {
    const result = (await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(options.rootPath).toString(),
      capabilities: { textDocument: { publishDiagnostics: {} } },
      initializationOptions: config.initializationOptions,
      clientInfo: { name: "tnt", version: "0.0.0-dev" },
    })) as { capabilities?: unknown } | null;
    if (!result || typeof result !== "object") {
      throw new LspProtocolError("language server did not answer initialize");
    }
    this.notify("initialized", {});
    return this;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("language server client is closed"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `language server did not answer ${method} within ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.disposed) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  openDocument(filePath: string, text: string): void {
    const uri = pathToFileURL(path.resolve(filePath)).toString();
    const languageId = languageIdForPath(filePath);
    this.openDocuments.set(uri, { text, languageId, version: 1 });
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  /** Opens a document, or pushes new text when the server already has it. */
  openOrUpdate(filePath: string, text: string): void {
    const uri = pathToFileURL(path.resolve(filePath)).toString();
    if (this.openDocuments.has(uri)) {
      this.updateDocument(filePath, text);
      return;
    }
    this.openDocument(filePath, text);
  }

  /**
   * Pushes new text for an already open document. A change to a document that
   * was never opened is ignored, since a server may not know about it.
   */
  updateDocument(filePath: string, text: string): void {
    const uri = pathToFileURL(path.resolve(filePath)).toString();
    const open = this.openDocuments.get(uri);
    if (!open) return;
    open.text = text;
    open.version += 1;
    this.notify("textDocument/didChange", {
      textDocument: { uri, version: open.version },
      contentChanges: [{ text }],
    });
  }

  /**
   * Kills the server without waiting for the protocol goodbye. Used on process
   * exit, where only synchronous work can still run.
   */
  killNow(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("language server client is closed"));
      this.pending.delete(id);
    }
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    for (const uri of this.openDocuments.keys()) {
      // Best effort: a server that is going away does not need didClose.
      this.sendFrame({
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: { textDocument: { uri } },
      });
    }
    this.openDocuments.clear();
    try {
      await this.request("shutdown", null);
    } catch {
      // A server that will not shut down cleanly still gets killed below.
    }
    this.disposed = true;
    this.sendFrame({ jsonrpc: "2.0", method: "exit" });
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("language server client is closed"));
      this.pending.delete(id);
    }
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private send(payload: unknown): void {
    if (this.disposed) return;
    this.sendFrame(payload);
  }

  private sendFrame(payload: unknown): void {
    if (!this.child.stdin.writable) return;
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  private fail(message: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
      this.pending.delete(id);
    }
    this.disposed = true;
    this.onServerError?.(message);
  }

  private ingest(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      const start = headerEnd + 4;
      if (!match) {
        this.buffer = this.buffer.subarray(start);
        continue;
      }
      const length = Number(match[1]);
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      this.dispatch(body);
    }
  }

  private dispatch(body: string): void {
    let message: {
      id?: number;
      method?: string;
      params?: any;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(body);
    } catch {
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const uri = message.params?.uri;
      const diagnostics = message.params?.diagnostics;
      if (typeof uri === "string" && Array.isArray(diagnostics)) {
        this.onDiagnostics?.(uri, diagnostics as LspDiagnostic[]);
      }
      return;
    }

    if (message.id === undefined) return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(
        new Error(message.error.message ?? "language server returned an error"),
      );
      return;
    }
    entry.resolve(message.result ?? null);
  }
}
