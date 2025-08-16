import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { loadAllPlugins } from "../plugins/loader.js";
import { logger } from "../utils/logger.js";

import { LspClient, LspDiagnostic, LspServerConfig } from "./client.js";

const DIAGNOSTIC_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 50;

/**
 * The subset of the LSP symbol shape the CLI reads. A server may answer with
 * SymbolInformation or WorkspaceSymbol; both carry a location and a name.
 */
export interface LspSymbol {
  name: string;
  kind?: number;
  containerName?: string;
  location?: {
    uri?: string;
    range?: { start?: { line?: number; character?: number } };
  };
}

interface RunningServer {
  name: string;
  client: LspClient;
}

/**
 * A plugin declares its servers as manifest data, so every field is validated
 * before a process is spawned: a malformed entry is skipped and named rather
 * than run.
 */
function toServerConfig(raw: unknown): LspServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const config = raw as Record<string, unknown>;
  if (typeof config.command !== "string" || !config.command.trim()) return null;
  const args = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : undefined;
  const env =
    config.env && typeof config.env === "object" && !Array.isArray(config.env)
      ? Object.fromEntries(
          Object.entries(config.env as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  return {
    command: config.command,
    args,
    env,
    initializationOptions: config.initializationOptions,
  };
}

/**
 * Keeps plugin language servers alive for a workspace and remembers the last
 * diagnostics each one published. Servers start lazily on the first request so
 * a session that never asks pays nothing for them.
 */
export class LspManager {
  private readonly servers = new Map<string, RunningServer>();
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  private starting: Promise<void> | null = null;

  async ensureStarted(rootPath: string): Promise<number> {
    if (!this.starting) {
      this.starting = this.startAll(rootPath).finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
    return this.servers.size;
  }

  private async startAll(rootPath: string): Promise<void> {
    const declared = loadAllPlugins().lspServers;
    for (const server of declared) {
      if (this.servers.has(server.name)) continue;
      const config = toServerConfig(server.config);
      if (!config) {
        logger.warn(
          `Skipping language server ${server.name}: no usable command`,
        );
        continue;
      }
      try {
        const client = await LspClient.start(config, {
          rootPath,
          onDiagnostics: (uri, published) => {
            this.diagnostics.set(uri, published);
          },
          onServerError: (message) => {
            logger.warn(`Language server ${server.name}: ${message}`);
            this.servers.delete(server.name);
          },
        });
        this.servers.set(server.name, { name: server.name, client });
      } catch (error) {
        logger.warn(
          `Language server ${server.name} did not start: ${(error as Error).message}`,
        );
      }
    }
  }

  runningServers(): string[] {
    return [...this.servers.keys()].sort();
  }

  /**
   * Asks every running server for symbols matching a query and merges the
   * answers. One server failing does not hide another's results.
   */
  async findSymbols(query: string): Promise<LspSymbol[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const clients = [...this.servers.values()].map((entry) => entry.client);
    const answers = await Promise.all(
      clients.map(async (client) => {
        try {
          return (await client.request("workspace/symbol", {
            query: trimmed,
          })) as LspSymbol[] | null;
        } catch {
          return null;
        }
      }),
    );
    const symbols: LspSymbol[] = [];
    for (const answer of answers) {
      if (Array.isArray(answer)) symbols.push(...answer);
    }
    return symbols;
  }

  /**
   * Opens a document in every running server and waits a bounded time for the
   * diagnostics. A server that never answers yields the empty list rather than
   * blocking the caller.
   */
  async collectDiagnostics(filePath: string): Promise<LspDiagnostic[]> {
    const absolute = path.resolve(filePath);
    const uri = pathToFileURL(absolute).toString();
    const clients = [...this.servers.values()].map((entry) => entry.client);
    if (clients.length === 0) return [];

    this.diagnostics.delete(uri);
    let text: string;
    try {
      text = fs.readFileSync(absolute, "utf-8");
    } catch {
      return [];
    }
    for (const client of clients) {
      // A repeated didOpen is a protocol error, so a second request for the
      // same file is sent as a change instead.
      client.openOrUpdate(absolute, text);
    }

    const deadline = Date.now() + DIAGNOSTIC_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const published = this.diagnostics.get(uri);
      if (published) return published;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return this.diagnostics.get(uri) ?? [];
  }

  async dispose(): Promise<void> {
    const clients = [...this.servers.values()].map((entry) => entry.client);
    this.servers.clear();
    this.diagnostics.clear();
    await Promise.all(
      clients.map((client) => client.dispose().catch(() => {})),
    );
  }
}

let manager: LspManager | null = null;

export function getLspManager(): LspManager {
  manager ??= new LspManager();
  return manager;
}
